// Store twins of the lane-authority fixes (#3335, #3334, #3330, #3331). Every
// rule pinned for signals in spec-async-semantics.test.ts is pinned here
// against the equivalent store shape: an optimistic store leaf reached
// through the proxy — not a createOptimistic node — must answer the same
// way, or the fix bounces straight back as a store issue.
//
// #3330 store twin needed two store-side rules the node path already had:
// an adoption under a live transaction HOLDS on optimistic families too (a
// sync derive adopting truth is held truth, not lane business — unheld, the
// optimistic write compared equal to it and wrote no override), and a held
// adoption notifies its nodes at write time (stageHeldAdoptions) so the
// commit promotes silently instead of re-marking every subscriber.
// #3331 store twin needed the authoritative landing on an override-covered
// node to reach the engine (setSignal → _landOnOverride → supersedeOverride)
// and supersededRead to serve the committed truth once the landing has
// committed ahead of the override's revert (mainline flush ordering).
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  reconcile
} from "../../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
  flush();
};
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("store twins of the lane-authority fixes (#3335/#3334/#3330/#3331)", () => {
  it("#3335 twin: two optimistic STORE writes read in one memo entangle; the later lane's landing does not release the merged reveal", async () => {
    const [a, setA] = createOptimisticStore({ v: 0 });
    const [b, setB] = createOptimisticStore({ v: 0 });
    const gateA = deferred();
    const gateB = deferred();
    const cells = { A: 0, B: 0, pair: "0:0" };
    const frames: string[] = [];
    const snap = () => `A=${cells.A} B=${cells.B} pair=${cells.pair}`;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const asyncA = createMemo(async () => {
        const v = a.v;
        if (v !== 0) await gateA.promise;
        return v;
      });
      const asyncB = createMemo(async () => {
        const v = b.v;
        if (v !== 0) await gateB.promise;
        return v;
      });
      const pair = createMemo(() => `${a.v}:${b.v}`);
      createRenderEffect(asyncA, v => {
        cells.A = v;
        frames.push(snap());
      });
      createRenderEffect(asyncB, v => {
        cells.B = v;
        frames.push(snap());
      });
      createRenderEffect(pair, v => {
        cells.pair = v;
        frames.push(snap());
      });
    });
    flush();
    await tick();
    frames.length = 0;
    const holdA = deferred();
    const holdB = deferred();
    const actA = action(function* (v: number) {
      setA(s => {
        s.v = v;
      });
      yield holdA.promise;
    });
    const actB = action(function* (v: number) {
      setB(s => {
        s.v = v;
      });
      yield holdB.promise;
    });
    const doneA = actA(1);
    await tick();
    expect(frames).toEqual([]);
    const doneB = actB(1);
    await tick();
    expect(frames).toEqual([]);
    gateB.resolve();
    await tick();
    expect(frames).toEqual([]); // B landed; A still in flight — merged reveal held
    gateA.resolve();
    await tick();
    expect(frames).toHaveLength(3);
    expect(frames.at(-1)).toBe("A=1 B=1 pair=1:1");
    holdA.resolve();
    holdB.resolve();
    await doneA;
    await doneB;
  });

  it("#3330 twin: a derivation of an optimistic STORE override reveals with it when the transaction already holds the same result", async () => {
    const [serverValue, setServerValue] = createSignal(0);
    const log: string[] = [];
    let release!: () => void;
    let releaseEnd!: () => void;
    let state!: { v: number };
    let setState!: any;
    createRoot(() => {
      [state, setState] = createOptimisticStore(() => ({ v: serverValue() }), { v: 0 });
      const doubled = createMemo(() => state.v * 2);
      createRenderEffect(
        () => `v=${state.v} d=${doubled()}`,
        s => {
          log.push(s);
        }
      );
    });
    flush();
    expect(log).toEqual(["v=0 d=0"]);
    const run = action(function* () {
      setServerValue(1);
      yield new Promise<void>(r => (release = r));
      setState((s: any) => {
        s.v = 1;
      });
      yield new Promise<void>(r => (releaseEnd = r));
    });
    const done = run();
    await settle();
    expect(log).toEqual(["v=0 d=0"]);
    // The derive's truth is held by the action's transaction: handlers read
    // committed, latest() the hold — the optimistic family holds like any
    // projection (unheld, the swapped-in backing leaked to handlers and
    // inverted latest()).
    expect(state.v).toBe(0);
    expect(latest(() => state.v)).toBe(1);
    release();
    await settle();
    const probeLog = JSON.stringify(log);
    releaseEnd();
    await done;
    await settle();
    expect(probeLog).toBe(JSON.stringify(["v=0 d=0", "v=1 d=2"]));
    expect(log).toEqual(["v=0 d=0", "v=1 d=2"]);
    expect(state.v).toBe(1);
    expect(isPending(() => state.v)).toBe(false);
  });

  it("#3331 twin: the derived optimistic STORE's own source landing a different value supersedes the override now", async () => {
    const [value, setValue] = createSignal(0);
    const pending: Array<{ v: number; resolve: () => void }> = [];
    const fetch = (v: number) =>
      new Promise<number>(resolve => pending.push({ v, resolve: () => resolve(v * 2) }));
    const resolveAll = () => {
      const p = pending.splice(0);
      p.forEach(x => x.resolve());
    };
    const flights: Array<{ n: number; resolve: () => void }> = [];
    const log: string[] = [];
    let state!: { d: number };
    let setState!: any;
    createRoot(() => {
      [state, setState] = createOptimisticStore(async () => ({ d: await fetch(value()) }), {
        d: 0
      });
      const asyncMemo = createMemo(() => {
        const n = state.d;
        return new Promise<string>(resolve =>
          flights.push({ n, resolve: () => resolve(`${n} async`) })
        );
      });
      const b = createLoadingBoundary(
        () => `double=${state.d} async=${asyncMemo()}`,
        () => "loading"
      );
      createRenderEffect(b, s => {
        log.push(s);
      });
    });
    flush();
    resolveAll();
    await settle();
    flights.shift()!.resolve();
    await settle();
    expect(log.at(-1)).toBe("double=0 async=0 async");
    log.length = 0;

    setValue(1);
    setState((s: any) => {
      s.d = 3;
    });
    flush();
    expect(flights.map(f => f.n)).toEqual([3]);
    expect(log).toEqual([]);
    expect(state.d).toBe(3);

    resolveAll(); // truth: 2 ≠ 3
    await settle();
    expect(flights.map(f => f.n)).toEqual([3, 2]); // graph moves to 2 NOW
    expect(latest(() => state.d)).toBe(2);
    expect(state.d).toBe(3);
    expect(isPending(() => state.d)).toBe(true);
    expect(log).toEqual([]);

    flights.shift()!.resolve(); // superseded 3-flight: nothing
    await settle();
    expect(log).toEqual([]);
    expect(state.d).toBe(3);

    flights.shift()!.resolve();
    await settle();
    expect(log).toEqual(["double=2 async=2 async"]);
    expect(state.d).toBe(2);
    expect(isPending(() => state.d)).toBe(false);
  });

  it("#3334 twin: a reader switching onto an in-flight derived STORE leaf holds on the flight, never shows the pre-flight value", async () => {
    const [a, setA] = createSignal(0);
    const [pick, setPick] = createSignal(0);
    const gate = deferred();
    let resolveNow = true;
    const [shared] = createStore(
      async () => {
        const v = a();
        if (!resolveNow) await gate.promise;
        return { v: "v" + v };
      },
      { v: "" }
    );
    const other = createMemo(() => "other");
    const out: unknown[] = [];
    createRoot(() => {
      createLoadingBoundary(
        () =>
          createRenderEffect(
            () => (pick() ? shared.v : other()),
            v => void out.push(v)
          ),
        () => "fallback"
      );
    });
    flush();
    expect(out).toEqual(["other"]);
    createRoot(() =>
      createRenderEffect(
        () => shared.v,
        () => {}
      )
    );
    await settle();
    resolveNow = false;
    setA(1);
    flush();
    setPick(1);
    flush();
    expect(out).toEqual(["other"]);
    expect(pick()).toBe(0);
    gate.resolve();
    await settle();
    expect(out).toEqual(["other", "v1"]);
    expect(pick()).toBe(1);
  });

  describe("adoptions under a live transaction hold — plain, derived, optimistic", () => {
    function observe<T>(fn: () => T): T[] {
      const out: T[] = [];
      createRoot(() => {
        createRenderEffect(fn, v => {
          out.push(v);
        });
      });
      flush();
      return out;
    }

    it("a key first read under a held adoption is born holding: handler committed, latest() the hold, the truth at the commit (derived store)", async () => {
      const [sv, setSv] = createSignal(0);
      let state!: { v: number; w: number };
      createRoot(() => {
        [state] = createStore(() => ({ v: sv(), w: sv() * 10 }), { v: 0, w: 0 });
      });
      flush();
      let release!: () => void;
      const run = action(function* () {
        setSv(1);
        yield new Promise<void>(r => (release = r));
      });
      const done = run();
      await settle();
      // No node existed for `w` before the hold.
      const late = observe(() => state.w);
      let m!: () => number;
      createRoot(() => {
        m = createMemo(() => state.w);
      });
      flush();
      expect(state.w).toBe(0);
      expect(latest(() => state.w)).toBe(10);
      expect(isPending(() => state.w)).toBe(true);
      release();
      await done;
      await settle();
      expect(late.at(-1)).toBe(10);
      expect(m()).toBe(10);
      expect(state.w).toBe(10);
      expect(isPending(() => state.w)).toBe(false);
    });

    it("same on an optimistic derived store", async () => {
      const [sv, setSv] = createSignal(0);
      let state!: { v: number; w: number };
      createRoot(() => {
        [state] = createOptimisticStore(() => ({ v: sv(), w: sv() * 10 }), { v: 0, w: 0 });
      });
      flush();
      let release!: () => void;
      const run = action(function* () {
        setSv(1);
        yield new Promise<void>(r => (release = r));
      });
      const done = run();
      await settle();
      const late = observe(() => state.w);
      expect([state.w, latest(() => state.w), isPending(() => state.w)]).toEqual([0, 10, true]);
      release();
      await done;
      await settle();
      expect(late.at(-1)).toBe(10);
      expect(state.w).toBe(10);
    });

    it("a plain store's reconcile inside an action holds: handlers read committed until the commit", async () => {
      const [s, setS] = createStore({ v: 0 });
      const log = observe(() => s.v);
      let release!: () => void;
      const run = action(function* () {
        setS(reconcile({ v: 1 }));
        yield new Promise<void>(r => (release = r));
      });
      const done = run();
      await settle();
      expect(log).toEqual([0]);
      expect(s.v).toBe(0);
      expect(latest(() => s.v)).toBe(1);
      release();
      await done;
      await settle();
      expect(log).toEqual([0, 1]);
      expect(s.v).toBe(1);
    });
  });
});
