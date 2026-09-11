/**
 * A lane reveals ahead of its transaction, and async derived from the lane
 * holds that reveal — under the SAME rule a transaction uses (INV-3): the
 * async holds when a render effect observes it and the pending reaches the
 * queue. Async nobody renders holds nothing; async caught by a loading
 * boundary that shows its fallback holds nothing (#3289).
 *
 * Both lane kinds are covered: a `createOptimistic` write and a `latest()`
 * read inside an action.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
  flush();
}

type Shape = "observed" | "unobserved" | "boundary";

describe("lane async holds on observation, like a transaction (#3289)", () => {
  describe("createOptimistic lane", () => {
    function setup(shape: Shape) {
      const [opt, setOpt] = createOptimistic(0);
      // One gate per run: the mount run is released in setup, the write's run
      // waits on a fresh one the test releases.
      const gates = { current: deferred() };
      const shown: number[] = [];
      const derivedShown: unknown[] = [];
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const derived = createMemo(async () => {
          const v = opt();
          await gates.current.promise;
          return v * 10;
        });
        createRenderEffect(opt, v => void shown.push(v));
        if (shape === "observed") createRenderEffect(derived, v => void derivedShown.push(v));
        else if (shape === "boundary") {
          // `on`: the boundary resets to its fallback on each write — a boundary
          // that MAY go to fallback. (An initialized boundary with no reset
          // forwards the pending and holds, exactly like a transaction.)
          const b = createLoadingBoundary(derived, () => "loading", { on: opt });
          createRenderEffect(b, v => void derivedShown.push(v));
        }
      });
      flush();
      const mountGate = gates.current;
      gates.current = deferred();
      mountGate.resolve();
      const gate = gates.current;
      return { opt, setOpt, gate, shown, derivedShown, dispose };
    }

    it("observed derived async holds the lane's other effects", async () => {
      const { setOpt, gate, shown, derivedShown, dispose } = setup("observed");
      await tick();
      expect(shown).toEqual([0]);
      expect(derivedShown).toEqual([0]);
      const hold = deferred();
      const act = action(function* () {
        setOpt(1);
        yield hold.promise;
      });
      const done = act();
      await tick();
      // The derived memo is pending and rendered: the lane waits for it.
      expect(shown).toEqual([0]);
      gate.resolve();
      await tick();
      expect(shown).toEqual([0, 1]);
      expect(derivedShown).toEqual([0, 10]);
      hold.resolve();
      await done;
      await tick();
      dispose();
    });

    it("unobserved derived async does not hold the lane", async () => {
      const { setOpt, gate, shown, dispose } = setup("unobserved");
      await tick();
      expect(shown).toEqual([0]);
      const hold = deferred();
      const act = action(function* () {
        setOpt(1);
        yield hold.promise;
      });
      const done = act();
      await tick();
      // Nothing renders the memo: no frame can tear, the lane reveals now.
      expect(shown).toEqual([0, 1]);
      gate.resolve();
      hold.resolve();
      await done;
      await tick();
      dispose();
    });

    it("derived async caught by a fallback-showing boundary does not hold the lane", async () => {
      const { setOpt, gate, shown, derivedShown, dispose } = setup("boundary");
      await tick();
      expect(shown).toEqual([0]);
      expect(derivedShown.at(-1)).toBe(0);
      const hold = deferred();
      const act = action(function* () {
        setOpt(1);
        yield hold.promise;
      });
      const done = act();
      await tick();
      // The boundary consumed the pending: the lane reveals, exactly as a
      // transaction would. (The boundary's own fallback flip is a plain write
      // staged in the action, so it is not visible until the action settles —
      // the same as for any transaction.)
      expect(shown).toEqual([0, 1]);
      gate.resolve();
      hold.resolve();
      await done;
      await tick();
      // Settled: the optimistic reverts to its base and the memo follows it.
      expect(shown.at(-1)).toBe(0);
      expect(derivedShown.at(-1)).toBe(0);
      dispose();
    });
  });

  it("an async memo CREATED under the lane and observed holds it (stamp at recompute)", async () => {
    // Nothing propagated a lane onto a node that did not exist when the
    // optimistic write fanned out; its own first compute under the lane must
    // tag it, or the queue cannot tell whose async it is.
    const [opt, setOpt] = createOptimistic(0);
    const gate = deferred();
    const shown: number[] = [];
    const inner: unknown[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(opt, v => void shown.push(v));
      const mounted = createMemo(() => opt() > 0);
      createRenderEffect(mounted, on => {
        if (!on) return;
        // Mounted by the lane's reveal: created, computed and observed under it.
        createRoot(() => {
          const derived = createMemo(async () => {
            const v = opt();
            await gate.promise;
            return v * 10;
          });
          createRenderEffect(derived, v => void inner.push(v));
        });
      });
    });
    flush();
    await tick();
    expect(shown).toEqual([0]);
    const hold = deferred();
    const act = action(function* () {
      setOpt(1);
      yield hold.promise;
    });
    const done = act();
    await tick();
    // The direct display revealed 1 (that reveal is what mounted the child);
    // the child's observed async is the lane's now, so a SECOND lane write
    // waits for it.
    expect(shown).toEqual([0, 1]);
    expect(inner).toEqual([]);
    setOpt(2);
    await tick();
    expect(shown).toEqual([0, 1]);
    gate.resolve();
    await tick();
    expect(shown).toEqual([0, 1, 2]);
    hold.resolve();
    await done;
    await tick();
    dispose();
  });

  describe("latest() lane (GabbeV's reduction)", () => {
    function setup(shape: Shape) {
      const [b, setB] = createSignal(0);
      const gates = { current: deferred() };
      const shownLatest: number[] = [];
      const shownPending: boolean[] = [];
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const derived = createMemo(async () => {
          const v = latest(b);
          await gates.current.promise;
          return v * 10;
        });
        createRenderEffect(
          () => latest(b),
          v => void shownLatest.push(v)
        );
        createRenderEffect(
          () => isPending(() => latest(b)),
          v => void shownPending.push(v)
        );
        if (shape === "observed") createRenderEffect(derived, () => {});
        else if (shape === "boundary")
          createRenderEffect(
            createLoadingBoundary(derived, () => "loading", { on: () => latest(b) }),
            () => {}
          );
      });
      flush();
      const mountGate = gates.current;
      gates.current = deferred();
      mountGate.resolve();
      const gateMemo = gates.current;
      return { setB, gateMemo, shownLatest, shownPending, dispose };
    }

    it("an unobserved async memo reading latest(b) does not stop latest(b) from rendering", async () => {
      const { setB, gateMemo, shownLatest, dispose } = setup("unobserved");
      await tick();
      expect(shownLatest).toEqual([0]);
      const hold = deferred();
      const act = action(function* () {
        setB(1);
        yield hold.promise;
      });
      const done = act();
      await tick();
      expect(shownLatest).toEqual([0, 1]);
      gateMemo.resolve();
      hold.resolve();
      await done;
      await tick();
      dispose();
    });

    it("an observed async memo reading latest(b) holds latest(b)'s reveal until it lands", async () => {
      const { setB, gateMemo, shownLatest, dispose } = setup("observed");
      await tick();
      expect(shownLatest).toEqual([0]);
      const hold = deferred();
      const act = action(function* () {
        setB(1);
        yield hold.promise;
      });
      const done = act();
      await tick();
      expect(shownLatest).toEqual([0]);
      gateMemo.resolve();
      await tick();
      expect(shownLatest).toEqual([0, 1]);
      hold.resolve();
      await done;
      await tick();
      dispose();
    });

    it("a fallback-showing boundary around the memo does not hold latest(b)", async () => {
      const { setB, gateMemo, shownLatest, dispose } = setup("boundary");
      await tick();
      expect(shownLatest).toEqual([0]);
      const hold = deferred();
      const act = action(function* () {
        setB(1);
        yield hold.promise;
      });
      const done = act();
      await tick();
      expect(shownLatest).toEqual([0, 1]);
      gateMemo.resolve();
      hold.resolve();
      await done;
      await tick();
      dispose();
    });
  });

  /**
   * #3335 — a hold is a property of the async node, not of the root lane's
   * transaction. Two optimistic writes from two transactions merge through a
   * shared reader (A15 for lanes: one reveal unit). Each lane's observed
   * async was recorded in ITS transaction; after the merge the root belongs
   * to one of them. The merged lane is held while ANY member's observed
   * async is in flight — the check must follow each node to the transaction
   * that observed it, never the root's.
   */
  describe("merged lanes across transactions hold on every member's async (#3335)", () => {
    function setup() {
      const [a, setAInner] = createOptimistic(0);
      const [b, setBInner] = createOptimistic(0);
      const gateA = deferred();
      const gateB = deferred();
      const cells = { A: 0, B: 0, pair: "0:0" };
      const frames: string[] = [];
      const snap = () => `A=${cells.A} B=${cells.B} pair=${cells.pair}`;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const asyncA = createMemo(async () => {
          const v = a();
          if (v !== 0) await gateA.promise;
          return v;
        });
        const asyncB = createMemo(async () => {
          const v = b();
          if (v !== 0) await gateB.promise;
          return v;
        });
        const pair = createMemo(() => `${a()}:${b()}`);
        // Per-cell readers, as compiled JSX produces: the pair memo is the
        // only shared reader, and it is what merges the two lanes.
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
      const holdA = deferred();
      const holdB = deferred();
      const actA = action(function* (v: number) {
        setAInner(v);
        yield holdA.promise;
      });
      const actB = action(function* (v: number) {
        setBInner(v);
        yield holdB.promise;
      });
      return { actA, actB, gateA, gateB, holdA, holdB, frames, dispose };
    }

    it("the later lane's flight landing first does not release the merged reveal", async () => {
      const { actA, actB, gateA, gateB, holdA, holdB, frames, dispose } = setup();
      await tick();
      frames.length = 0;
      const doneA = actA(1);
      await tick();
      expect(frames).toEqual([]); // A's async observed pending: lane A held
      const doneB = actB(1);
      await tick();
      expect(frames).toEqual([]); // merged: still held on A's flight
      gateB.resolve();
      await tick();
      // B landed, but A — observed in A's transaction — is still in flight.
      expect(frames).toEqual([]);
      gateA.resolve();
      await tick();
      // One reveal unit: nothing ran before this round (asserted above) and
      // all three cells land in it. Effects apply sequentially inside the
      // round; the frame the screen shows is its end state.
      expect(frames).toHaveLength(3);
      expect(frames.at(-1)).toBe("A=1 B=1 pair=1:1");
      holdA.resolve();
      holdB.resolve();
      await doneA;
      await doneB;
      await tick();
      dispose();
    });

    it("the earlier lane's flight landing first does not release the merged reveal", async () => {
      const { actA, actB, gateA, gateB, holdA, holdB, frames, dispose } = setup();
      await tick();
      frames.length = 0;
      const doneA = actA(1);
      await tick();
      const doneB = actB(1);
      await tick();
      gateA.resolve();
      await tick();
      // A landed; B — the root's own transaction — is still in flight.
      expect(frames).toEqual([]);
      gateB.resolve();
      await tick();
      expect(frames).toHaveLength(3);
      expect(frames.at(-1)).toBe("A=1 B=1 pair=1:1");
      holdA.resolve();
      holdB.resolve();
      await doneA;
      await doneB;
      await tick();
      dispose();
    });
  });
});
