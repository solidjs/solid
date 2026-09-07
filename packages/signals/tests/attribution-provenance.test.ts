/**
 * Provenance: who performed a write.
 *
 * Claim under test: every root ChangeRecord carries the imperative frame that
 * produced it — the user interaction the web runtime declares around dispatch
 * (`withInteraction`), an effect callback, an action step, an async landing —
 * or `external` when none applies; and frames nested under an interaction
 * (an action a click started, an effect a click's write caused, a landing a
 * click's write launched) carry that interaction, so downstream facts —
 * re-runs, holds — can be keyed by what the user did.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  DEV,
  flush
} from "../src/index.js";
import type { ChangeOrigin, RerunEvent } from "../src/core/attribution.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  const runs: RerunEvent[] = [];
  DEV!.attribution.subscribe(e => runs.push(e));
  return runs;
}

const CLICK = { type: "click", target: 'button#next "Next →"' };
/** The root cause of the latest re-run of `name`. */
const rootCause = (runs: RerunEvent[], name: string) =>
  runs.filter(r => r.nodeName === name).at(-1)!.causes[0];

describe("write provenance", () => {
  it("stamps writes outside any frame as external, and says nothing about them", () => {
    const runs = arm();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    const cause = rootCause(runs, "reader");
    expect(cause.origin).toEqual({ kind: "external" });
    expect(DEV!.attribution.format(runs.at(-1)!)).not.toContain("—");
  });

  it("stamps writes inside withInteraction with the interaction", () => {
    const runs = arm();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createEffect(n, () => {}, { name: "reader" }));
    flush();
    const before = performance.now();
    DEV!.attribution.withInteraction(CLICK, () => setN(1));
    flush();
    const cause = rootCause(runs, "reader");
    expect(cause.origin).toMatchObject({
      kind: "interaction",
      name: "click",
      target: CLICK.target
    });
    expect(cause.origin!.at).toBeGreaterThanOrEqual(before);
    const run = runs.at(-1)!;
    expect(run.interaction).toBe(cause.origin);
    expect(DEV!.attribution.format(run)).toContain(`n" write (#`);
    expect(DEV!.attribution.format(run)).toContain(`— click on button#next "Next →"`);
  });

  it("stamps an effect's writes with the effect, under the interaction that caused its run", () => {
    const runs = arm();
    const [n, setN] = createSignal(0, { name: "n" });
    const [copy, setCopy] = createSignal(0, { name: "copy" });
    createRoot(() => {
      createEffect(
        n,
        v => {
          setCopy(v);
        },
        { name: "sync" }
      );
      createEffect(copy, () => {}, { name: "reader" });
    });
    flush();
    DEV!.attribution.withInteraction(CLICK, () => setN(1));
    flush();
    const cause = rootCause(runs, "reader");
    expect(cause.origin).toMatchObject({
      kind: "effect",
      name: "sync",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(DEV!.attribution.format(runs.at(-1)!)).toContain(
      `— effect "sync" (under click on button#next "Next →")`
    );
    // The reader's run traces to the click through the relay.
    expect(runs.at(-1)!.interaction).toMatchObject({ kind: "interaction", name: "click" });
  });

  it("stamps every step of an action with the action, under the interaction that started it", async () => {
    const runs = arm();
    const [a, setA] = createSignal(0, { name: "a" });
    const [b, setB] = createSignal(0, { name: "b" });
    createRoot(() => {
      createEffect(a, () => {}, { name: "readA" });
      createEffect(b, () => {}, { name: "readB" });
    });
    flush();
    let release!: () => void;
    const saveAction = action(function* save() {
      setA(1);
      yield new Promise<void>(r => (release = r));
      setB(2);
    });
    const done = DEV!.attribution.withInteraction(CLICK, () => saveAction());
    await wait(5);
    release();
    await done;
    await until(() => b() === 2, "the action to commit");

    const expected: Partial<ChangeOrigin> = {
      kind: "action",
      name: "save",
      interaction: { kind: "interaction", name: "click", target: CLICK.target }
    };
    expect(rootCause(runs, "readA").origin).toMatchObject(expected);
    // The post-yield step resumed from a promise callback: still the action's, still the click's.
    expect(rootCause(runs, "readB").origin).toMatchObject(expected);
  });

  it("marks writes after an await (not a yield) as external — the documented escape", async () => {
    const runs = arm();
    const [a, setA] = createSignal(0, { name: "a" });
    const [b, setB] = createSignal(0, { name: "b" });
    const [c, setC] = createSignal(0, { name: "c" });
    createRoot(() => {
      createEffect(a, () => {}, { name: "readA" });
      createEffect(b, () => {}, { name: "readB" });
      createEffect(c, () => {}, { name: "readC" });
    });
    flush();
    const runAction = action(async function* run() {
      setA(1);
      await Promise.resolve();
      setB(2); // escapes the transaction — and the action frame
      yield;
      setC(3);
    });
    await runAction();
    await until(() => c() === 3, "the action to commit");
    expect(rootCause(runs, "readA").origin).toMatchObject({ kind: "action", name: "run" });
    expect(rootCause(runs, "readB").origin).toEqual({ kind: "external" });
    expect(rootCause(runs, "readC").origin).toMatchObject({ kind: "action", name: "run" });
  });

  it("stamps an async landing with the flight, under the interaction whose write launched it", async () => {
    const runs = arm();
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const posts = createMemo(
      () => {
        const p = page();
        return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
      },
      { name: "posts" }
    );
    const shown: string[] = [];
    createRoot(() =>
      createRenderEffect(
        posts,
        v => {
          shown.push(v);
        },
        { name: "feed" }
      )
    );
    flush();
    resolve("a");
    await until(() => shown.includes("a-p1"), "initial load");
    // The initial flight was launched by mount, under no interaction.
    expect(rootCause(runs, "feed").origin).toMatchObject({ kind: "async", name: "posts" });
    expect(rootCause(runs, "feed").origin!.interaction).toBeUndefined();

    DEV!.attribution.withInteraction(CLICK, () => setPage(2));
    flush();
    resolve("b");
    await until(() => shown.includes("b-p2"), "the click's page to land");
    expect(rootCause(runs, "feed").origin).toMatchObject({
      kind: "async",
      name: "posts",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(runs.filter(r => r.nodeName === "feed").at(-1)!.interaction).toMatchObject({
      name: "click"
    });
  });
});

describe("holds carry their interaction", () => {
  it("measures the hold from the interaction and names it in SILENT_HOLD", async () => {
    arm();
    const events: DiagnosticEvent[] = [];
    DEV!.diagnostics.subscribe(e => {
      if (e.code === "SILENT_HOLD") events.push(e);
    });
    DEV!.attribution.enable({
      log: false,
      hotRuns: false,
      hotTime: false,
      waterfalls: false,
      holds: { infoMs: 0, warnMs: 0 }
    });
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const posts = createMemo(
      () => {
        const p = page();
        return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
      },
      { name: "posts" }
    );
    const shown: string[] = [];
    createRoot(() =>
      createRenderEffect(
        posts,
        v => {
          shown.push(v);
        },
        { name: "feed" }
      )
    );
    flush();
    resolve("a");
    await until(() => shown.includes("a-p1"), "initial load");

    // An interaction dispatched a while ago (input delay, handler work…):
    // the user has been waiting since THEN, not since the flush parked.
    const at = performance.now() - 1000;
    DEV!.attribution.withInteraction({ ...CLICK, at }, () => setPage(2));
    flush();
    resolve("b");
    await until(() => shown.includes("b-p2"), "the held page to land");

    const [hold] = DEV!.attribution.holds();
    expect(hold.interaction).toMatchObject({ kind: "interaction", name: "click", at });
    expect(hold.holdMs).toBeGreaterThanOrEqual(1000);
    expect(hold.heldWrites[0].origin).toBe(hold.interaction);

    expect(events).toHaveLength(1);
    expect(events[0].message).toContain(
      `[SILENT_HOLD] click on button#next "Next →" wrote "page" (1 → 2); the write was held`
    );
    expect(events[0].data).toMatchObject({
      interaction: { type: "click", target: CLICK.target }
    });
  });
});
