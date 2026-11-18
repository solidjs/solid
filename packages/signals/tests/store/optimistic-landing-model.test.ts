/**
 * Model probe for a DERIVED `createOptimisticStore`: guesses with landings.
 *
 * A keyed list is fetched from a fake server. Two or three actions each make
 * one optimistic edit, wait, write the server (confirming the edit, answering
 * differently, or not at all), `refresh()` the list, and may stay open after
 * that. Around them a poll changes the server and refreshes outside any
 * action, and fetches land in a random order of events.
 *
 * Nothing here takes a side on what the screen shows BETWEEN a landing and
 * the commit of the hold it landed under (the open rulings). The checks are
 * the ones every reading of the rules shares:
 *
 *   frame      every frame the screen showed has whole rows and no key twice (F-1)
 *   agree      an untracked read and `snapshot()` equal the screen at a quiet point
 *   live       a guess is on screen while its action's hold is open (F-11, D-33)
 *   gone       a value only a guess wrote is off screen once that hold commits,
 *              unless the server confirmed it (D-33)
 *   identity   a row that is on screen before and after a step keeps its proxy
 *              and is not mounted again (Q-D)
 *   final      when every action ended and every fetch landed: the screen is
 *              the server's list, every hold committed, and a later plain
 *              write still shows (nothing is parked)
 *
 * "Hold open" is observed, not modelled: each action ends with a plain signal
 * write, which shows exactly when its hold commits (F-2).
 *
 * Env: OPT_LAND_FORM=seeded|seedless  OPT_LAND_SEED  OPT_LAND_CASES
 *      OPT_LAND_ACTIONS=2|3  OPT_LAND_ONLY=<case index>
 *      OPT_LAND_REPORT=/path.json (every finding, smallest example per kind)
 *
 * The default run is the gate: a fixed seed and case count for each form
 * with two and with three actions, and the number of failing cases per kind
 * may not rise above `BASELINE`. Lower a baseline number when a fix lowers
 * the count; never raise one. Any env override turns the run into a survey
 * that prints its counts and asserts nothing.
 */
import { expect, test, vi } from "vitest";
import { writeFileSync } from "node:fs";

type Form = "seeded" | "seedless";
const FORMS = (
  process.env.OPT_LAND_FORM ? [process.env.OPT_LAND_FORM] : ["seeded", "seedless"]
) as Form[];
const SEED = +(process.env.OPT_LAND_SEED ?? 1);
const CASES = +(process.env.OPT_LAND_CASES ?? 100);
const ACTION_COUNTS = process.env.OPT_LAND_ACTIONS ? [+process.env.OPT_LAND_ACTIONS] : [2, 3];
const ONLY = process.env.OPT_LAND_ONLY;
const REPORT = process.env.OPT_LAND_REPORT;
const GATE =
  !process.env.OPT_LAND_FORM &&
  !process.env.OPT_LAND_SEED &&
  !process.env.OPT_LAND_CASES &&
  !process.env.OPT_LAND_ACTIONS &&
  !ONLY;

/** Failing cases per kind at the default seed and case count, by
 * `form/actions`. A kind not listed is 0. */
const BASELINE: Record<string, Record<string, number>> = {
  "seeded/2": { "agree: snapshot≠proxy": 1 },
  "seeded/3": {
    "agree: snapshot≠proxy": 7,
    "live: a guessed row is off screen": 2,
    "live: a removed row is on screen": 1,
    "frame: a torn frame was shown": 1
  },
  "seedless/2": { "agree: snapshot≠proxy": 3 },
  "seedless/3": {
    "agree: snapshot≠proxy": 5,
    "live: a guessed row is off screen": 2,
    "frame: a torn frame was shown": 2
  }
};

type Row = { id: number; n: number };
const ser = (rows: Row[]): string => {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) out.push(rows[i] ? `${rows[i].id}:${rows[i].n}` : "hole");
  return out.join(",");
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An edit of the list: the same function runs on a setter's draft and on
 * the server's array. Returns whether it changed anything. */
interface Edit {
  text: string;
  run: (d: Row[]) => boolean;
}
const setN = (id: number, v: number): Edit => ({
  text: `row(${id}).n = ${v}`,
  run: d => {
    const row = d.find(x => x.id === id);
    return row ? ((row.n = v), true) : false;
  }
});
const push = (id: number): Edit => ({
  text: `push {id:${id}}`,
  run: d => (d.push({ id, n: 0 }), true)
});
const remove = (id: number): Edit => ({
  text: `remove row(${id})`,
  run: d => {
    const at = d.findIndex(x => x.id === id);
    return at >= 0 ? (d.splice(at, 1), true) : false;
  }
});
const front = (id: number): Edit => ({
  text: `move row(${id}) to front`,
  run: d => {
    const at = d.findIndex(x => x.id === id);
    return at > 0 ? (d.unshift(d.splice(at, 1)[0]), true) : false;
  }
});
const nothing: Edit = { text: "nothing", run: () => false };

interface Act {
  guess: Edit;
  /** What the guess claims: checked while the hold is open. */
  claim: { set?: [id: number, v: number]; adds?: number; removes?: number };
  /** Values and ids only this guess wrote (fresh numbers). */
  own: { n?: number; id?: number };
  server: Edit;
  answer: "confirm" | "differ" | "reject";
  refresh: boolean;
  linger: boolean;
}
type Event = { t: "act"; k: number } | { t: "land" } | { t: "poll"; edit: Edit };
interface Case {
  form: Form;
  acts: Act[];
  events: Event[];
}

function genCase(form: Form, ACTIONS: number, r: () => number): Case {
  let n = 100;
  const fresh = () => ++n;
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const acts: Act[] = [];
  for (let k = 0; k < ACTIONS; k++) {
    const id = 1 + Math.floor(r() * 3);
    const kind = pick(["set", "set", "push", "push", "remove", "front"]);
    const answer = pick<Act["answer"]>(["confirm", "confirm", "differ", "reject"]);
    const v = fresh();
    let guess: Edit, server: Edit, claim: Act["claim"], own: Act["own"];
    if (kind === "set") {
      guess = setN(id, v);
      claim = { set: [id, v] };
      own = { n: v };
      server = answer === "confirm" ? guess : answer === "differ" ? setN(id, fresh()) : nothing;
    } else if (kind === "push") {
      guess = push(v);
      claim = { adds: v };
      own = { id: v };
      server = answer === "confirm" ? guess : answer === "differ" ? push(fresh()) : nothing;
    } else if (kind === "remove") {
      guess = remove(id);
      claim = { removes: id };
      own = {};
      server = answer === "reject" ? nothing : guess;
    } else {
      guess = front(id);
      claim = {};
      own = {};
      server = answer === "reject" ? nothing : guess;
    }
    acts.push({
      guess,
      claim,
      own,
      server,
      answer,
      refresh: server !== nothing || r() < 0.5,
      linger: r() < 0.35
    });
  }
  // Slices per action: the guess, the server write (+ refresh), the end.
  const left = acts.map(a => (a.linger ? 3 : 2));
  let polls = r() < 0.5 ? 1 : 0;
  const events: Event[] = [];
  while (left.some(x => x > 0) || polls > 0) {
    const roll = r();
    if (roll < 0.3) events.push({ t: "land" });
    else if (roll < 0.4 && polls > 0) {
      polls--;
      const id = 1 + Math.floor(r() * 3);
      events.push({ t: "poll", edit: pick([setN(id, fresh()), push(fresh()), remove(id)]) });
    } else {
      const open = left.map((x, k) => (x > 0 ? k : -1)).filter(k => k >= 0);
      if (open.length === 0) continue;
      const k = open[Math.floor(r() * open.length)];
      left[k]--;
      events.push({ t: "act", k });
    }
  }
  return { form, acts, events };
}

const describe = (c: Case) =>
  c.acts
    .map(
      (a, k) =>
        `${"ABC"[k]}: guess ${a.guess.text}; server ${a.answer} (${a.server.text})${
          a.refresh ? " + refresh" : ""
        }${a.linger ? "; stays open" : ""}`
    )
    .join("\n") +
  `\nevents: ${c.events
    .map(e => (e.t === "act" ? "ABC"[e.k] : e.t === "land" ? "land" : `poll(${e.edit.text})`))
    .join(" · ")}`;

interface Finding {
  kind: string;
  detail: string;
}

async function runCase(c: Case): Promise<Finding[]> {
  vi.resetModules();
  const S: typeof import("../../src/index.js") = await import("../../src/index.js");
  const findings: Finding[] = [];
  const warn = console.warn,
    error = console.error;
  console.warn = console.error = () => {};
  let dispose!: () => void;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise(res => setTimeout(res, 0));
      S.flush();
    }
  };
  try {
    const server: Row[] = [
      { id: 1, n: 0 },
      { id: 2, n: 0 },
      { id: 3, n: 0 }
    ];
    /** Every `n` and id the server has ever held. */
    const everN = new Set<number>([0]);
    const everId = new Set<number>([1, 2, 3]);
    const writeServer = (e: Edit) => {
      e.run(server);
      for (const row of server) (everN.add(row.n), everId.add(row.id));
    };
    const land: (() => void)[] = [];
    let list!: Row[], set!: (fn: (d: Row[]) => void) => void;
    let screen = "";
    const frames: string[] = [];
    let mounts: number[] = [];
    const done: boolean[] = c.acts.map(() => false);
    const setDone: ((v: boolean) => void)[] = [];
    let probe = 0,
      setProbe!: (v: number) => void;
    S.createRoot(d => {
      dispose = d;
      const fetch = () => new Promise<Row[]>(res => land.push(() => res(structuredClone(server))));
      [list, set] = (
        c.form === "seeded"
          ? S.createOptimisticStore<Row[]>(fetch, [], { key: "id" } as any)
          : S.createOptimisticStore<Row[]>(fetch, undefined as any, { key: "id" } as any)
      ) as any;
      const rows = S.mapArray(
        () => list,
        (row: Row) => {
          // A torn list can hand the mapper a hole: it is recorded as one
          // (the frame check), not thrown from inside a flush.
          if (row) mounts.push(row.id);
          return () => (row ? `${row.id}:${row.n}` : "hole");
        }
      );
      S.createRenderEffect(
        () =>
          rows()
            .map(f => f())
            .join(","),
        v => {
          screen = v;
          frames.push(v);
        }
      );
      c.acts.forEach((_, k) => {
        const [g, s] = S.createSignal(false);
        setDone[k] = s;
        S.createRenderEffect(g, v => void (done[k] = v));
      });
      const [p, sp] = S.createSignal(0);
      setProbe = sp;
      S.createRenderEffect(p, v => void (probe = v));
    });
    S.flush();
    land.shift()!();
    await settle();

    const started: boolean[] = c.acts.map(() => false);
    const applied: boolean[] = c.acts.map(() => false);
    const callOrder: number[] = [];
    const gates: (() => void)[][] = c.acts.map(() => []);
    const promises: Promise<unknown>[] = [];
    const act = S.action(function* (k: number): Generator<Promise<void>, void, void> {
      const a = c.acts[k];
      set(d => void (applied[k] = a.guess.run(d)));
      started[k] = true;
      callOrder.push(k);
      yield new Promise<void>(res => gates[k].push(res));
      writeServer(a.server);
      if (a.refresh) S.refresh(list as any);
      if (a.linger) yield new Promise<void>(res => gates[k].push(res));
      setDone[k](true);
    });

    const view = (): Row[] =>
      S.untrack(() => Array.from({ length: list.length }, (_, i) => list[i]));
    const check = (where: string, before: Map<number, Row>) => {
      const rows = view();
      const unt = ser(rows);
      const snap = ser(S.snapshot(list) as Row[]);
      const at = `${where}; holds open: ${
        c.acts.map((_, i) => (started[i] && !done[i] ? "ABC"[i] : "")).join("") || "none"
      }`;
      if (unt !== screen)
        findings.push({
          kind: "agree: untracked≠screen",
          detail: `${at}\n  screen    ${screen}\n  untracked ${unt}`
        });
      if (snap !== unt)
        findings.push({
          kind: "agree: snapshot≠proxy",
          detail: `${at}\n  proxy    ${unt}\n  snapshot ${snap}`
        });
      const shown = new Map(
        screen === ""
          ? []
          : screen.split(",").map(s => s.split(":").map(Number) as [number, number])
      );
      // live: the newest open guess per claim, in call order.
      const removed = new Set<number>();
      const field = new Map<number, number>();
      for (const k of callOrder) {
        if (done[k] || !applied[k]) continue;
        const cl = c.acts[k].claim;
        if (cl.removes !== undefined) removed.add(cl.removes);
        if (cl.set) field.set(cl.set[0], cl.set[1]);
        if (cl.adds !== undefined && !shown.has(cl.adds))
          findings.push({
            kind: "live: a guessed row is off screen",
            detail: `${at}\n  ${"ABC"[k]} added ${cl.adds}\n  screen ${screen}`
          });
      }
      for (const id of removed)
        if (shown.has(id))
          findings.push({
            kind: "live: a removed row is on screen",
            detail: `${at}\n  removed ${id}\n  screen ${screen}`
          });
      for (const [id, v] of field)
        if (shown.has(id) && shown.get(id) !== v)
          findings.push({
            kind: "live: a guessed field is off screen",
            detail: `${at}\n  row ${id} guessed ${v}\n  screen ${screen}`
          });
      // gone: what only a committed hold's guess wrote.
      for (let k = 0; k < c.acts.length; k++) {
        if (!done[k]) continue;
        const own = c.acts[k].own;
        if (own.id !== undefined && !everId.has(own.id) && shown.has(own.id))
          findings.push({
            kind: "gone: a guessed row outlives its hold",
            detail: `${at}\n  ${"ABC"[k]} added ${own.id}\n  screen ${screen}`
          });
        if (own.n !== undefined && !everN.has(own.n) && [...shown.values()].includes(own.n))
          findings.push({
            kind: "gone: a guessed field outlives its hold",
            detail: `${at}\n  ${"ABC"[k]} wrote ${own.n}\n  screen ${screen}`
          });
      }
      // identity: a row on screen before and after the step.
      for (const row of rows) {
        if (!row || !before.has(row.id)) continue;
        if (before.get(row.id) !== row)
          findings.push({
            kind: "identity: a row on screen changed its proxy",
            detail: `${at}\n  row ${row.id}\n  screen ${screen}`
          });
        else if (mounts.includes(row.id))
          findings.push({
            kind: "identity: a row on screen was mounted again",
            detail: `${at}\n  row ${row.id}\n  screen ${screen}`
          });
      }
    };
    const snapshotView = () =>
      new Map(
        view()
          .filter(Boolean)
          .map(row => [row.id, row])
      );

    const slice: number[] = c.acts.map(() => 0);
    for (let step = 0; step < c.events.length; step++) {
      const e = c.events[step];
      const before = snapshotView();
      mounts = [];
      let text: string;
      if (e.t === "act") {
        if (slice[e.k]++ === 0) promises[e.k] = act(e.k);
        else gates[e.k].shift()?.();
        text = "ABC"[e.k];
      } else if (e.t === "land") {
        land.shift()?.();
        text = "land";
      } else {
        writeServer(e.edit);
        S.refresh(list as any);
        text = `poll(${e.edit.text})`;
      }
      await settle();
      check(`after step ${step + 1} (${text})`, before);
    }
    // Drain: every gate, then every fetch, until nothing is left.
    for (let i = 0; i < 12; i++) {
      for (const g of gates) for (let f; (f = g.shift()); ) f();
      for (let f; (f = land.shift()); ) f();
      await settle();
      if (!land.length && gates.every(g => !g.length)) break;
    }
    await Promise.all(promises);
    await settle();
    for (let f; (f = land.shift()); ) f();
    await settle();

    const truth = ser(server);
    if (done.some(d => !d))
      findings.push({
        kind: "final: a hold never commits",
        detail: `done=${done}\n  screen ${screen}\n  server ${truth}`
      });
    if (screen !== truth || ser(view()) !== truth)
      findings.push({
        kind: "final: the screen is not the server's list",
        detail: `screen ${screen}\n  proxy  ${ser(view())}\n  server ${truth}`
      });
    setProbe(1);
    S.flush();
    await settle();
    if (probe !== 1)
      findings.push({ kind: "final: a later plain write is parked", detail: `screen ${screen}` });
    for (const f of frames) {
      const ids = f === "" ? [] : f.split(",").map(s => s.split(":")[0]);
      if (f.includes("hole") || f.includes("undefined") || new Set(ids).size !== ids.length) {
        findings.push({
          kind: "frame: a torn frame was shown",
          detail: `frame ${f}\n  all frames ${JSON.stringify(frames)}`
        });
        break;
      }
    }
  } catch (e: any) {
    findings.push({ kind: "throw", detail: String(e?.stack ?? e?.message ?? e).slice(0, 1500) });
  } finally {
    try {
      dispose?.();
    } catch {}
    console.warn = warn;
    console.error = error;
  }
  return findings;
}

for (const form of FORMS)
  for (const ACTIONS of ACTION_COUNTS)
    test(`optimistic landing model: ${form}, seed ${SEED}, ${CASES} cases, ${ACTIONS} actions`, async () => {
      const base = BASELINE[`${form}/${ACTIONS}`] ?? {};
      const r = rng(SEED * 7919 + form.length + ACTIONS * 31);
      const byKind: Record<string, number> = {};
      const all: any[] = [];
      const examples: Record<string, { size: number; text: string }> = {};
      let failing = 0;
      for (let i = 0; i < CASES; i++) {
        const c = genCase(form, ACTIONS, r);
        if (ONLY !== undefined && +ONLY !== i) continue;
        const fs = await runCase(c);
        if (fs.length === 0) continue;
        failing++;
        const kinds = new Set(fs.map(f => f.kind));
        all.push({ i, kinds: [...kinds].sort(), text: describe(c), first: fs[0].detail });
        for (const kind of kinds) {
          byKind[kind] = (byKind[kind] ?? 0) + 1;
          const size = c.events.length;
          if (!examples[kind] || size < examples[kind].size)
            examples[kind] = {
              size,
              text: `case ${i}\n${describe(c)}\n${fs.find(f => f.kind === kind)!.detail}`
            };
        }
      }
      if (REPORT)
        writeFileSync(
          REPORT.replace(/\.json$/, `-${form}-${ACTIONS}.json`),
          JSON.stringify(
            { form, seed: SEED, cases: CASES, actions: ACTIONS, failing, byKind, examples, all },
            null,
            2
          )
        );
      if (!GATE || process.env.OPT_LAND_PRINT)
        console.log(
          `\n${form}, ${ACTIONS} actions, seed ${SEED}: ${failing}/${CASES} cases with a finding\n` +
            Object.entries(byKind)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `  ${k}: ${v}`)
              .join("\n")
        );
      if (GATE) {
        const over = Object.entries(byKind).filter(([k, v]) => v > (base[k] ?? 0));
        expect(
          over.map(([k, v]) => `${k}: ${v} cases (baseline ${base[k] ?? 0})\n${examples[k].text}`)
        ).toEqual([]);
      }
    }, 600_000);
