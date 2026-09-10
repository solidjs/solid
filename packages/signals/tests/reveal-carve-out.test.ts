// A15 reveal corollary, re-ruled 2026-09-10 (#3305, #3334; review on #3347).
//
// A stale (render) reader that lands on a node pending in some OTHER
// transaction shows the node's committed value, does not entangle the two
// transactions, and re-derives at that transaction's commit — parallel
// transactions, effects don't entangle. The carve-out is refused (the reveal
// holds on the flight) only when the committed value would tear against the
// visible frame: the flight's inputs were PUBLISHED while it was pending
// (CONFIG_INPUTS_PUBLISHED — a batch committed with the node still in the
// air, #3305) or the node rides a live lane (optimistic / latest, #3334).
// Those refusals are pinned in spec-async-semantics; this file pins the
// carve-out itself, the replay that finishes it, and the exactness of the
// two refusals (neither is sticky).
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  flush();
}
type Gate = { v: number; d: ReturnType<typeof deferred<number>> };

describe("reveal carve-out: a stale reader of a foreign-held flight (A15)", () => {
  // GabbeV's case A (#3347 review): B is revealed while `input`'s write is
  // held by the flight `slow` blocks. It shows the coherent committed pair
  // `0:0` (input is 0 on screen; `fast` settled on 0) and must catch up when
  // the hold commits — the recording in `_gatedSubs` is the notification,
  // since the commit itself is silent.
  it("a reader revealed during a held update shows the committed pair and catches up at the commit", async () => {
    const rendered: Record<string, unknown> = {};
    const gates: Gate[] = [];
    let setInput!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [input, si] = createSignal(0);
      const [show, ss] = createSignal(false);
      setInput = si;
      setShow = ss;
      const shared = createMemo(() => input());
      const slow = createMemo(() => {
        const v = shared();
        const d = deferred<number>();
        gates.push({ v, d });
        return d.promise;
      });
      const fast = createMemo(async () => shared());
      const observe = (name: string, read: () => unknown) =>
        createRenderEffect(read, v => void (rendered[name] = v));
      observe("input", input);
      observe("show", show);
      observe("A", () => `${input()}:${slow()}`);
      observe("B", () => (show() ? `${input()}:${fast()}` : "hidden"));
    });
    try {
      flush();
      gates.shift()!.d.resolve(0);
      await settle();
      expect(rendered).toEqual({ input: 0, show: false, A: "0:0", B: "hidden" });

      setInput(2);
      await settle();
      expect(rendered).toEqual({ input: 0, show: false, A: "0:0", B: "hidden" });

      // The reveal: `show` commits (parallel transaction), B shows committed.
      setShow(true);
      await settle();
      expect(rendered).toEqual({ input: 0, show: true, A: "0:0", B: "0:0" });

      const g = gates.shift()!;
      g.d.resolve(g.v);
      await settle();
      await settle();
      expect(rendered).toEqual({ input: 2, show: true, A: "2:2", B: "2:2" });
    } finally {
      dispose();
    }
  });

  // GabbeV's case B: two conditional readers hide, are asked to show again
  // while `details` is pending, and the input is changed back. Every reader
  // must publish the final world once it settles.
  it("a conditional reader hidden and re-shown around a pending flight publishes the settled world", async () => {
    const rendered: Record<string, unknown> = {};
    const gates: Gate[] = [];
    let setInput!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [input, si] = createSignal(0);
      const [show, ss] = createSignal(true);
      setInput = si;
      setShow = ss;
      const details = createMemo(() => {
        const v = input();
        const d = deferred<number>();
        gates.push({ v, d });
        return d.promise;
      });
      const observe = (name: string, read: () => unknown) =>
        createRenderEffect(read, v => void (rendered[name] = v));
      observe("input", input);
      observe("show", show);
      observe("A", () => (show() ? input() : "hidden"));
      observe("B", () => (show() ? details() : "hidden"));
    });
    try {
      flush();
      gates.shift()!.d.resolve(0);
      await settle();
      expect(rendered).toEqual({ input: 0, show: true, A: 0, B: 0 });

      // The hide is queued ahead of the flush the write schedules.
      Promise.resolve().then(() => setShow(false));
      setInput(3);
      await settle();
      setShow(true);
      await settle();
      setInput(0);
      await settle();
      for (const g of gates.splice(0)) g.d.resolve(g.v);
      await settle();
      await settle();
      for (const g of gates.splice(0)) g.d.resolve(g.v);
      await settle();
      await settle();
      expect(rendered).toEqual({ input: 0, show: true, A: 0, B: 0 });
    } finally {
      dispose();
    }
  });

  // The published-inputs mark outlives the flight that earned it for as long
  // as the node stays pending — and no longer. `details`' first flight is
  // unobserved, so its write commits beneath it: `input` is 1 on screen while
  // the node's committed value still derives from 0. The next write is HELD
  // (a sibling flight, `twin`, is observed and opens T1), `details` replaces
  // its flight under T1 and is stamped with it. A reveal in another
  // transaction now finds a foreign-stamped pending node whose committed
  // value would tear against the published 1: it must hold (#3305), not carve
  // out. Once the node lands and later goes pending fresh under a hold, the
  // mark is gone and the carve-out applies again.
  it("a replacement flight over published inputs refuses the carve-out; a fresh flight after landing carves out again", async () => {
    const gates: Array<Gate & { who: string }> = [];
    const out: unknown[] = [];
    let setInput!: (v: number) => void;
    let setPick!: (v: number) => void;
    let input!: () => number;
    let details!: () => number;
    let dispose!: () => void;
    const land = (who: string) => {
      const i = gates.findIndex(g => g.who === who);
      expect(i).not.toBe(-1);
      const [g] = gates.splice(i, 1);
      g.d.resolve(g.v);
    };
    createRoot(d => {
      dispose = d;
      const [input_, si] = createSignal(0);
      const [pick, sp] = createSignal(0);
      input = input_;
      setInput = si;
      setPick = sp;
      const fetch = (who: string) => {
        const v = input_();
        const d = deferred<number>();
        gates.push({ who, v, d });
        return d.promise;
      };
      details = createMemo(() => fetch("details"));
      const twin = createMemo(() => fetch("twin"));
      createRenderEffect(
        () => (pick() ? details() : "other"),
        v => void out.push(v)
      );
      createRenderEffect(twin, () => {});
      createRenderEffect(input_, () => {});
    });
    try {
      flush();
      land("details");
      land("twin");
      await settle();
      setPick(1); // initialize details through the reader
      flush();
      expect(out).toEqual(["other", 0]);
      setPick(0);
      flush();
      out.length = 0;

      // Flight 1: `details` is unobserved — the write commits beneath it
      // (published); `twin` is observed and holds nothing else.
      setInput(1);
      flush();
      land("twin");
      await settle();
      await settle();
      expect([input(), gates.map(g => g.who)]).toEqual([1, ["details"]]);

      // The held write: `twin` re-reports, T1 opens holding `input = 2` and
      // stamps both flights; `details` replaces its flight under the hold.
      setInput(2);
      flush();
      expect([input(), gates.map(g => g.who)]).toEqual([1, ["details", "details", "twin"]]);

      // The reveal: committed value derives from 0, the screen shows 1 — hold.
      setPick(1);
      flush();
      expect(out).toEqual([]);
      land("details"); // the superseded flight's promise — ignored
      land("details");
      land("twin");
      await settle();
      await settle();
      expect([input(), out]).toEqual([2, [2]]);
      setPick(0);
      flush();
      out.length = 0;

      // A fresh flight from a settled state, held in T1 — unmarked: the
      // reveal shows committed 2, then the landing.
      createRoot(() =>
        createRenderEffect(
          () => details(),
          () => {}
        )
      );
      flush();
      setInput(3);
      flush();
      expect([input(), gates.map(g => g.who)]).toEqual([2, ["details", "twin"]]);
      setPick(1);
      flush();
      expect(out).toEqual([2]);
      land("details");
      land("twin");
      await settle();
      await settle();
      expect([input(), out]).toEqual([3, [2, 3]]);
    } finally {
      dispose();
    }
  });

  // Lane routing is judged live (`resolveLane`): a node that was once derived
  // under an optimistic lane, whose lane has since retired, is a plain held
  // flight to a later reveal.
  it("a retired lane does not make a later plain-held flight refuse the carve-out", async () => {
    const gates: Gate[] = [];
    const out: unknown[] = [];
    let setSrc!: (v: number) => void;
    let setPick!: (v: number) => void;
    let write!: (v: number) => Promise<unknown>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [src, ss] = createSignal(0);
      const [b, setB] = createOptimistic(src);
      const [pick, sp] = createSignal(0);
      setSrc = ss;
      setPick = sp;
      const details = createMemo(() => {
        const v = b();
        const d = deferred<number>();
        gates.push({ v, d });
        return d.promise;
      });
      const act = action(function* (v: number) {
        setB(v);
        setSrc(v);
        yield Promise.resolve();
      });
      write = v => act(v);
      createRenderEffect(b, () => {});
      createRenderEffect(
        () => details(),
        () => {}
      );
      createRenderEffect(
        () => (pick() ? details() : "other"),
        v => void out.push(v)
      );
    });
    try {
      flush();
      gates.shift()!.d.resolve(0);
      await settle();
      await settle();

      // A lane-routed flight: details derives under b's lane, lands, and the
      // action completes — the lane retires.
      const done = write(1);
      await settle();
      let g = gates.shift()!;
      g.d.resolve(g.v);
      await done;
      await settle();
      await settle();
      out.length = 0;

      // A plain held write: the observed flight holds src's write in T1.
      setSrc(2);
      flush();
      expect(gates.length).toBe(1);
      // A reveal in another transaction: no live lane, inputs unpublished —
      // committed 1 now, the landing later.
      setPick(1);
      flush();
      expect(out).toEqual([1]);
      g = gates.shift()!;
      g.d.resolve(g.v);
      await settle();
      await settle();
      expect(out).toEqual([1, 2]);
    } finally {
      dispose();
    }
  });
});
