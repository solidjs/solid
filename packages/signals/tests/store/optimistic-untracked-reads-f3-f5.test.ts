/**
 * Optimistic list holes — matrix findings F3 and F5
 * (optimistic-list-mutation-matrix.test.ts), the two scheduler halts a keyed
 * `mapArray` / `<For keyed={r => r.id}>` hit over an optimistic store.
 *
 * F5 — a derived optimistic store (`createOptimisticStore(() => truth())`)
 * whose truth lands with a DIFFERENT length than the optimistic frame. The
 * landing supersedes the `length` and presence overrides (#3331): tracked
 * reads served the staged truth through `serve`, but the untracked store
 * paths — the `length` view, the `has` trap, `ownKeys`, snapshot/deep — still
 * composed the override. mapArray reads the list tracked (`newItems.length`)
 * and untracked inside its owner (`newItems.slice(0)`), so its `_items`
 * snapshot came up short or holey and the NEXT pass keyed an `undefined` row.
 * Regressed in #3370 (b5bd6fba8, the #3331 supersession) — shipped in rc.9.
 *
 * F3 — a second tentative draft opened while a prior draft's overrides are
 * live (two pending actions, or two setter calls in one action). The `length`
 * draft arm re-composed the prior overrides onto the draft's already-seeded
 * backing, so after `splice(from, 1)` the length read one too long and the
 * second splice left a hole; every other draft channel gated on
 * draftSeesOverrides. Pre-existing since the store rewrite.
 *
 * Rule both fixes follow: every read channel of an optimistic store answers
 * one reader with ONE selection — `serve`'s (A17 override, lane gate, A18
 * supersession, A29 staged read) for readers; the seeded backing for a
 * draft — so `length`, indices, `in`, keys and snapshots never tear within a
 * pass.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  mapArray,
  resetErrorHalt,
  snapshot,
  untrack
} from "../../src/index.js";

interface Row {
  id: string;
}
const rows = (ids: string): Row[] => ids.split("").map(id => ({ id }));
const ids = (l: readonly (Row | undefined)[]) => l.map(r => (r ? r.id : "<hole>")).join("");
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
};
/** Lets a released action run to its commit, bounded (a halted scheduler
 * must fail on its frame, not on the test timeout). */
async function settle(done: Promise<unknown>) {
  flush();
  await Promise.race([
    done,
    (async () => {
      for (let i = 0; i < 10; i++) await tick();
    })()
  ]);
  flush();
  await tick();
  flush();
}

afterEach(() => {
  resetErrorHalt();
  flush();
});

type Source = "signal" | "async" | "chained";

/** The three truth channels: a signal the action writes after its await, an
 * async memo (the `createAsync` / router shape) re-fetched by a version
 * bump, and a base store the optimistic view chains over. */
function createSource(kind: Source) {
  let view!: Row[];
  let setView!: (fn: (d: Row[]) => void) => void;
  let land!: (truth: Row[]) => void;
  let db = rows("abc");
  const [truth, setTruth] = createSignal<Row[]>(rows("abc"));
  const [version, setVersion] = createSignal(0);
  if (kind === "signal") {
    [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
    land = t => setTruth(t);
  } else if (kind === "async") {
    const data = createMemo(async () => {
      version();
      await tick();
      return db.map(r => ({ ...r }));
    });
    [view, setView] = createOptimisticStore<Row[]>(() => data(), []);
    land = t => {
      db = t;
      setVersion(v => v + 1);
    };
  } else {
    const [base, setBase] = createStore<Row[]>(rows("abc"));
    [view, setView] = createOptimisticStore<Row[]>(base);
    land = t => setBase(d => void d.splice(0, d.length, ...t));
  }
  return { view, setView, land, kind };
}

async function ready(kind: Source) {
  flush();
  if (kind === "async") {
    await tick();
    await tick();
    flush();
  }
}

// ── F5 ──────────────────────────────────────────────────────────────────────

describe("F5: a landing whose length differs from the optimistic frame", () => {
  /** Keyed mapArray. The key function a user writes is `r => r.id`; an
   * undefined row throws, and a throw inside the graph halts the scheduler —
   * the StatusError it leaves as an unhandled rejection carries the node
   * graph, which vitest's reporter cannot serialize (OOM). So the hole is
   * RECORDED here (matrix-harness pattern) and asserted empty. */
  function renderKeyed(list: () => Row[]) {
    const frames: string[] = [];
    const holes: string[] = [];
    const mapped = mapArray(list, (item: () => Row) => () => item().id, {
      keyed: (r: Row | undefined) => {
        if (r === undefined) {
          holes.push(`keyed(undefined) after frame "${frames.at(-1)}"`);
          return "<hole>";
        }
        return r.id;
      }
    });
    createRenderEffect(
      () =>
        mapped()
          .map(f => f())
          .join(""),
      f => void frames.push(f)
    );
    return { frames, holes };
  }

  for (const kind of ["signal", "async"] as const) {
    it(`[${kind}] optimistic push, truth lands one row longer`, async () => {
      let src!: ReturnType<typeof createSource>;
      let frames!: string[], holes!: string[];
      const dispose = createRoot(d => {
        src = createSource(kind);
        ({ frames, holes } = renderKeyed(() => src.view));
        return d;
      });
      await ready(kind);
      expect(frames.at(-1)).toBe("abc");
      const g = gate();
      const run = action(function* () {
        src.setView(d => void d.push({ id: "x" }));
        yield g.promise;
        src.land(rows("abcxs")); // x confirmed, plus a server row: 4 -> 5
      });
      const done = run();
      flush();
      expect(frames.at(-1)).toBe("abcx");
      g.release();
      await settle(done);
      await ready(kind);
      expect(frames.at(-1)).toBe("abcxs");
      expect(untrack(() => ids(src.view))).toBe("abcxs");
      // the pass after the landing is the one that keyed `undefined`: a
      // further list change must not throw and must render the truth
      src.setView(d => void d.push({ id: "p" }));
      flush();
      expect(frames.at(-1)).toBe("abcxs"); // bare write outside an action: reverted at its flush
      expect(holes).toEqual([]);
      dispose();
      flush();
    });

    it(`[${kind}] optimistic pop, truth refills the slot (presence twin)`, async () => {
      let src!: ReturnType<typeof createSource>;
      let frames!: string[], holes!: string[];
      const dispose = createRoot(d => {
        src = createSource(kind);
        ({ frames, holes } = renderKeyed(() => src.view));
        return d;
      });
      await ready(kind);
      const g = gate();
      const run = action(function* () {
        src.setView(d => void d.pop());
        yield g.promise;
        src.land(rows("abs")); // c deleted, a server row lands in its slot: 2 -> 3
      });
      const done = run();
      flush();
      expect(frames.at(-1)).toBe("ab");
      g.release();
      await settle(done);
      await ready(kind);
      expect(frames.at(-1)).toBe("abs");
      src.setView(d => void d.push({ id: "p" }));
      flush();
      expect(frames.at(-1)).toBe("abs");
      expect(holes).toEqual([]);
      dispose();
      flush();
    });
  }

  it("[chained] the same landing never tore (control)", async () => {
    let src!: ReturnType<typeof createSource>;
    let frames!: string[], holes!: string[];
    const dispose = createRoot(d => {
      src = createSource("chained");
      ({ frames, holes } = renderKeyed(() => src.view));
      return d;
    });
    flush();
    const g = gate();
    const run = action(function* () {
      src.setView(d => void d.push({ id: "x" }));
      yield g.promise;
      src.land(rows("abcxs"));
    });
    const done = run();
    flush();
    g.release();
    await settle(done);
    expect(frames.at(-1)).toBe("abcxs");
    expect(holes).toEqual([]);
    dispose();
    flush();
  });

  /** Every channel a deriving reader can use, sampled in ONE memo pass. At
   * the landing pass all of them must agree (`length`, spread, slice, keys,
   * `in`, snapshot(), deep()) — previously snapshot/deep and Object.keys
   * lagged the traps by one row. */
  function channels(view: Row[]) {
    return {
      length: view.length,
      spread: ids([...view]),
      slice: ids(view.slice(0)),
      keys: Object.keys(view).length,
      has: [0, 1, 2, 3, 4].filter(i => i in view).length,
      snapshot: ids(snapshot(view)),
      deep: ids(deep(view)),
      untrackedInOwner: untrack(() => `${view.length}:${ids(view.slice(0))}`)
    };
  }
  type Sample = ReturnType<typeof channels>;
  const expectCoherent = (s: Sample) => {
    const label = JSON.stringify(s);
    expect(s.spread, label).not.toContain("<hole>");
    expect(s.spread.length, label).toBe(s.length);
    expect(s.slice, label).toBe(s.spread);
    expect(s.keys, label).toBe(s.length);
    expect(s.has, label).toBe(s.length);
    expect(s.snapshot, label).toBe(s.spread);
    expect(s.deep, label).toBe(s.spread);
    expect(s.untrackedInOwner, label).toBe(`${s.length}:${s.spread}`);
  };

  for (const [name, mutate, truth] of [
    ["push, landing longer", (d: Row[]) => void d.push({ id: "x" }), "abcxs"],
    ["pop, landing refills", (d: Row[]) => void d.pop(), "abs"]
  ] as const) {
    it(`parity: length, spread, keys, in, snapshot, deep agree in every pass (${name})`, async () => {
      const samples: Sample[] = [];
      let src!: ReturnType<typeof createSource>;
      const dispose = createRoot(d => {
        src = createSource("signal");
        const m = createMemo(() => channels(src.view));
        createRenderEffect(m, s => void samples.push(s));
        return d;
      });
      flush();
      const g = gate();
      const run = action(function* () {
        src.setView(mutate);
        yield g.promise;
        src.land(rows(truth));
      });
      const done = run();
      flush();
      g.release();
      await settle(done);
      for (const s of samples) expectCoherent(s);
      expect(samples.at(-1)!.spread).toBe(truth);
      // a context-free read after the commit: the truth
      expect(untrack(() => ids(src.view))).toBe(truth);
      dispose();
      flush();
    });
  }
});

// ── F3 ──────────────────────────────────────────────────────────────────────

describe("F3: a second draft while a prior draft's overrides are live", () => {
  const spliceMove = (from: number, to: number) => (d: Row[]) => {
    const [r] = d.splice(from, 1);
    d.splice(to, 0, r);
  };
  const six = () => rows("abcdef");

  function probe(view: Row[]) {
    let memo!: () => string;
    createRoot(() => {
      memo = createMemo(() => `${view.length}:${ids(view)}`);
    });
    flush();
    return { memo, untracked: () => untrack(() => `${view.length}:${ids(view)}`) };
  }

  for (const kind of ["derived", "chained"] as const) {
    it(`[${kind}] two pending actions, splice moves: no hole, no stale length`, async () => {
      let view!: Row[], setView!: (fn: (d: Row[]) => void) => void;
      const dispose = createRoot(d => {
        if (kind === "derived") {
          const [truth] = createSignal<Row[]>(six());
          [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
        } else {
          const [base] = createStore<Row[]>(six());
          [view, setView] = createOptimisticStore<Row[]>(base);
        }
        return d;
      });
      const p = probe(view);
      const run = action(function* (m: (d: Row[]) => void, g: { promise: Promise<void> }) {
        setView(m);
        yield g.promise;
      });
      const ga = gate();
      const doneA = run(spliceMove(0, 5), ga);
      flush();
      expect(p.untracked()).toBe("6:bcdefa");
      expect(p.memo()).toBe("6:bcdefa");
      const gb = gate();
      const doneB = run(spliceMove(2, 4), gb);
      flush();
      expect(p.untracked()).toBe("6:bcefda");
      expect(p.memo()).toBe("6:bcefda");
      ga.release();
      gb.release();
      await settle(doneA);
      await settle(doneB);
      expect(p.untracked()).toBe("6:abcdef"); // no truth landed: both revert
      dispose();
      flush();
    });
  }

  it("one action, two setter calls (two drafts): no hole", async () => {
    let view!: Row[], setView!: (fn: (d: Row[]) => void) => void;
    const dispose = createRoot(d => {
      const [truth] = createSignal<Row[]>(six());
      [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
      return d;
    });
    const p = probe(view);
    const g = gate();
    const run = action(function* () {
      setView(spliceMove(0, 5));
      setView(spliceMove(2, 4));
      yield g.promise;
    });
    const done = run();
    flush();
    expect(p.untracked()).toBe("6:bcefda");
    expect(p.memo()).toBe("6:bcefda");
    g.release();
    await settle(done);
    dispose();
    flush();
  });

  it("mid-draft: length shrinks with the splice and `length = n` reads back n", () => {
    let view!: Row[], setView!: (fn: (d: Row[]) => void) => void;
    const dispose = createRoot(d => {
      const [truth] = createSignal<Row[]>(six());
      [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
      return d;
    });
    probe(view);
    const log: string[] = [];
    const run = action(function* (g: { promise: Promise<void> }) {
      setView(spliceMove(0, 5));
      setView(d => {
        log.push(`seeded ${d.length}:${ids(d)}`);
        d.splice(2, 1);
        log.push(`spliced ${d.length}:${ids(d)} 5in=${5 in d}`);
        d.length = 5;
        log.push(`assigned ${d.length}`);
      });
      yield g.promise;
    });
    void run(gate());
    flush();
    expect(log).toEqual(["seeded 6:bcdefa", "spliced 5:bcefa 5in=false", "assigned 5"]);
    expect(untrack(() => `${view.length}:${ids(view)}`)).toBe("5:bcefa");
    dispose();
    flush();
  });
});
