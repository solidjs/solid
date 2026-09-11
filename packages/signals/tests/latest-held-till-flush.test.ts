/**
 * Writes become visible at flush — to every read channel.
 *
 * `latest()` reads the FLUSHED staged world: the value a held transition has
 * computed but not yet committed. An unflushed write is visible to no reader
 * at all — not the plain read, not `latest()`, not `isPending()`. The only
 * consumer of an unflushed value is the setter's own functional updater.
 * Read-your-own-writes is therefore `flush()` then read, and it works the
 * same whether or not the write is held:
 *
 *   setFoo(2); flush(); latest(foo) // 2, held or not
 *
 * This supersedes the #2922 ruling (untracked latest() pulled the shadow up
 * to date mid-tick so `setS(1); latest(m)` derived pre-flush). That answer
 * was per-node: the signal read new, a sync derivation read new, an async
 * derivation read old — a torn view that also changed depending on whether a
 * companion happened to exist already (a lazily created companion backfilled
 * from the eager `_pendingValue` and disagreed with an existing one). One
 * rule replaces it: nothing pre-flush, the flushed world after.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  isPending,
  latest,
  snapshot,
  untrack
} from "../src/index.js";

/** A signal whose write is held by an async memo a render effect observes. */
async function heldSetup(initial = 10) {
  let resolve!: (v: number) => void;
  const fetch = (n: number) =>
    new Promise<number>(r => {
      resolve = r;
    });
  const [count, setCount] = createSignal(initial);
  let data!: () => number;
  createRoot(() => {
    data = createMemo(() => fetch(count()));
    createRenderEffect(
      () => data(),
      () => {}
    );
  });
  flush();
  resolve(initial);
  await new Promise(r => setTimeout(r, 0));
  flush();
  expect(count()).toBe(initial);
  return { count, setCount, data, settle: () => resolve };
}

describe("latest() is held till flush", () => {
  it("latest(signal): unflushed write invisible; visible after flush", () => {
    const [s, setS] = createSignal(0);
    flush();
    setS(1);
    expect(latest(s)).toBe(0);
    expect(s()).toBe(0);
    flush();
    expect(latest(s)).toBe(1);
    expect(s()).toBe(1);
  });

  it("latest(memo): does not derive downstream pre-flush", () => {
    const [s, setS] = createSignal(0);
    let m!: () => number;
    createRoot(() => {
      m = createMemo(() => s() * 2 + 1);
    });
    flush();
    expect(m()).toBe(1);
    setS(1);
    expect(latest(m)).toBe(1); // was 3 under #2922
    expect(m()).toBe(1);
    setS(2);
    expect(latest(m)).toBe(1);
    flush();
    expect(m()).toBe(5);
    expect(latest(m)).toBe(5);
  });

  it("flush() then latest() is read-your-own-writes under a held transition", async () => {
    const { count, setCount } = await heldSetup(10);
    setCount(20);
    expect(latest(count)).toBe(10); // unflushed
    flush(); // held by the fetch — plain read stays committed
    expect(count()).toBe(10);
    expect(latest(count)).toBe(20); // the flushed staged world
  });

  it("a rewrite of a held node is invisible until its own flush (existing companion)", async () => {
    const { count, setCount } = await heldSetup(10);
    setCount(20);
    flush();
    expect(latest(count)).toBe(20); // companion exists now
    setCount(30);
    expect(latest(count)).toBe(20); // not 30, not 10
    expect(count()).toBe(10);
    flush();
    expect(latest(count)).toBe(30);
    expect(count()).toBe(10);
  });

  it("a companion created after the rewrite agrees with one that existed before it", async () => {
    // Gabriel's case: committed 10, flushed-held 20, unflushed 30. A brand-new
    // companion has no history to consult — the node must retain the flushed
    // staged value itself.
    const { count, setCount } = await heldSetup(10);
    setCount(20);
    flush();
    setCount(30);
    expect(latest(count)).toBe(20); // first-ever latest() read
    flush();
    expect(latest(count)).toBe(30);
  });

  it("a companion created pre-flush on a node that was not held reads committed", () => {
    const [s, setS] = createSignal(10);
    flush();
    setS(30);
    expect(latest(s)).toBe(10); // first-ever latest() read; the eager _pendingValue is 30
    flush();
    expect(latest(s)).toBe(30);
  });

  it("memo transparency: a getter and a memo wrapping latest() agree pre- and post-flush", async () => {
    const { count, setCount } = await heldSetup(0);
    const getter = () => latest(count);
    let memo!: () => number;
    createRoot(() => {
      memo = createMemo(() => latest(count));
    });
    flush();
    expect([getter(), memo()]).toEqual([0, 0]);
    setCount(1);
    expect([getter(), memo()]).toEqual([0, 0]); // was [1, 0]
    flush(); // held by the fetch; the latest lane is not held, so the memo commits
    expect([getter(), memo()]).toEqual([1, 1]);
    expect(count()).toBe(0);
  });

  it("a tracked latest() reader created after an unflushed write still updates at flush", () => {
    const [s, setS] = createSignal(0);
    flush();
    setS(1);
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => latest(s),
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    expect(seen).toEqual([1]);
  });

  it("a tracked latest() reader created after an unflushed rewrite of a held node updates at flush", async () => {
    // The reader links to the shadow while the rewrite is unflushed and reads
    // the flushed value (20). It must be re-marked when the rewrite flushes —
    // a reader that saw 20 and was never woken would be stale at 20 forever.
    const { count, setCount } = await heldSetup(10);
    setCount(20);
    flush();
    setCount(30);
    let memo!: () => number;
    createRoot(() => {
      memo = createMemo(() => latest(count));
    });
    expect(memo()).toBe(20);
    flush();
    expect(memo()).toBe(30);
  });

  it("isPending() follows the same clock: false for an unflushed write, true once flushed and held", async () => {
    const { count, setCount } = await heldSetup(10);
    expect(isPending(count)).toBe(false);
    setCount(20);
    expect(isPending(count)).toBe(false); // nothing flushed to be pending
    flush();
    expect(isPending(count)).toBe(true); // held by the fetch
  });

  it("functional updaters still compose across unflushed writes", () => {
    const [s, setS] = createSignal(10);
    flush();
    setS(v => v + 1);
    setS(v => v + 1);
    expect(latest(s)).toBe(10);
    flush();
    expect(s()).toBe(12);
  });

  it("latest(memo) reads the flushed held derivation, not a mid-tick one", async () => {
    const { count, setCount } = await heldSetup(10);
    let double!: () => number;
    createRoot(() => {
      double = createMemo(() => count() * 2);
    });
    flush();
    expect(latest(double)).toBe(20);
    setCount(20);
    expect(latest(double)).toBe(20); // 40 would be a mid-tick derivation
    flush(); // held
    expect(double()).toBe(20);
    expect(latest(double)).toBe(40); // flushed staged world, coherent with latest(count)
    expect(latest(count)).toBe(20);
  });
});

/**
 * A28 consequence (3), one level down (#3336): a companion created lazily
 * answers as if it had always existed — and so does a store node. Whether
 * SOME reader had already created a companion (or materialized a key) before
 * the hold must not be observable: A and B below differ only in that.
 */
describe("#3336: lazily created companions and store nodes carry the hold", () => {
  const settle = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
    flush();
  };

  it("a latest() companion created under a foreign hold does not revert at the reader's flush", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const [show, setShow] = createSignal(false);
    const runs: Array<number[] | null> = [];
    createRoot(() => {
      const valueA = createMemo(a);
      const valueB = createMemo(b);
      createMemo(() => latest(valueB)); // B's companion exists before the hold; A's does not
      createRenderEffect(
        () =>
          show() ? [latest(valueA), latest(valueB), valueA(), valueB(), latest(a), a()] : null,
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    let release!: () => void;
    const update = action(function* () {
      setA(1);
      setB(1);
      yield new Promise<void>(r => (release = r));
    });
    update();
    await settle();
    setShow(true);
    await settle();
    // One run: latest() reads the flushed staged world for both, plain reads
    // stay committed for both. Before the fix the fresh companion's backfill
    // registered in the render effect's ambient batch, reverted at that
    // flush's end and re-ran the effect with [0, 1, 0, 0, 0, 0].
    expect(runs).toEqual([null, [1, 1, 0, 0, 1, 0]]);
    release();
    await settle();
    expect(runs).toEqual([null, [1, 1, 0, 0, 1, 0], [1, 1, 1, 1, 1, 1]]);
  });

  it("an isPending() companion created under a foreign hold stays true until the hold lifts", async () => {
    const [a, setA] = createSignal(0);
    const [show, setShow] = createSignal(false);
    const pendings: Array<boolean | null> = [];
    createRoot(() => {
      const valueA = createMemo(a);
      createRenderEffect(
        () => (show() ? isPending(valueA) : null),
        v => {
          pendings.push(v);
        }
      );
    });
    flush();
    let release!: () => void;
    const update = action(function* () {
      setA(1);
      yield new Promise<void>(r => (release = r));
    });
    update();
    await settle();
    setShow(true);
    await settle();
    expect(pendings).toEqual([null, true]); // no flip to false at the reader's flush end
    release();
    await settle();
    expect(pendings).toEqual([null, true, false]);
  });

  it("a store key first read under a hold is born holding: plain reads committed, latest() staged", async () => {
    const [a, setA] = createStore({ count: 0 });
    const [b, setB] = createStore({ count: 0 });
    const [show, setShow] = createSignal(false);
    const runs: Array<number[] | null> = [];
    createRoot(() => {
      createMemo(() => b.count); // b.count has a node before the hold; a.count does not
      createRenderEffect(
        () => (show() ? [a.count, b.count, latest(() => a.count), latest(() => b.count)] : null),
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    let release!: () => void;
    const update = action(function* () {
      setA(s => {
        s.count = 1;
      });
      setB(s => {
        s.count = 1;
      });
      yield new Promise<void>(r => (release = r));
    });
    update();
    await settle();
    setShow(true);
    await settle();
    // Before the fix: [1, 0, 1, 0] — the held write leaked through the plain
    // read of the key nothing had subscribed to, and B's fresh companion
    // reverted at the flush end.
    expect(runs).toEqual([null, [0, 0, 1, 1]]);
    release();
    await settle();
    expect(runs).toEqual([null, [0, 0, 1, 1], [1, 1, 1, 1]]);
  });

  describe("every store read channel answers like core read() under a foreign hold", () => {
    // Core: `(stale && el._transition !== null) → _value`. A render effect
    // (stale) and a handler (no owner) see committed; latest()/isPending()
    // see the hold. The channel — tracked, untracked, `in`, keys,
    // deep()/snapshot() — and whether the key had a node before the hold
    // must not change the answer.
    async function heldStore() {
      const [a, setA] = createStore<{ count: number; added?: number; list: number[] }>({
        count: 0,
        list: [1]
      });
      const [b, setB] = createStore({ count: 0 });
      createRoot(() => {
        createMemo(() => b.count); // observed before the hold
      });
      flush();
      const update = action(function* () {
        setA(s => {
          s.count = 1;
          s.added = 5;
          s.list.push(2);
        });
        setB(s => {
          s.count = 1;
        });
        yield new Promise<void>(() => {});
      });
      update();
      await settle();
      return { a, b };
    }
    function inRenderEffect<T>(fn: () => T): T[] {
      const out: T[] = [];
      createRoot(() => {
        createRenderEffect(fn, v => {
          out.push(v);
        });
      });
      flush();
      return out;
    }

    it("render effect: untracked reads, `in`, Object.keys, deep(), snapshot() all read committed", async () => {
      const { a, b } = await heldStore();
      expect(inRenderEffect(() => untrack(() => [a.count, b.count]))).toEqual([[0, 0]]);
      expect(inRenderEffect(() => "added" in a)).toEqual([false]);
      expect(inRenderEffect(() => Object.keys(a).includes("added"))).toEqual([false]);
      expect(inRenderEffect(() => a.list.length)).toEqual([1]);
      expect(inRenderEffect(() => deep(a).count)).toEqual([0]);
      expect(inRenderEffect(() => snapshot(a).count)).toEqual([0]);
    });

    it("render effect: latest() and isPending() see the hold on both keys", async () => {
      const { a, b } = await heldStore();
      expect(inRenderEffect(() => [latest(() => a.count), latest(() => b.count)])).toEqual([
        [1, 1]
      ]);
      expect(inRenderEffect(() => [isPending(() => a.count), isPending(() => b.count)])).toEqual([
        [true, true]
      ]);
    });

    it("handler: plain, deep(), snapshot(), `in`, keys read committed; latest()/isPending() see the hold", async () => {
      const { a, b } = await heldStore();
      expect([a.count, b.count, deep(a).count, snapshot(a).count]).toEqual([0, 0, 0, 0]);
      expect(["added" in a, Object.keys(a).includes("added")]).toEqual([false, false]);
      expect([latest(() => a.count), latest(() => b.count)]).toEqual([1, 1]);
      expect([isPending(() => a.count), isPending(() => b.count)]).toEqual([true, true]);
    });

    it("a memo outside the transaction answers the same for both keys", async () => {
      const { a, b } = await heldStore();
      let m!: () => number[];
      createRoot(() => {
        m = createMemo(() => [a.count, b.count]);
      });
      flush();
      const [x, y] = m();
      expect(x).toBe(y);
    });

    it("a render effect recomputing inside the holding transaction sees the write on every channel", async () => {
      // Core: `activeTransition !== el._transition` — the clause is for a
      // FOREIGN hold. A render effect the transaction itself recomputes (its
      // run is the transaction's to apply) reads `_pendingValue` through the
      // tracked read; the untracked read, `in`, keys and deep() must agree,
      // or the effect composes its view — and its subscriptions — from two
      // worlds.
      const [s, setS] = createStore<{ count: number; added?: number; list: number[] }>({
        count: 0,
        list: [1]
      });
      const frames: unknown[] = [];
      createRoot(() => {
        createRenderEffect(
          () =>
            frames.push([
              s.count,
              untrack(() => s.count),
              "added" in s,
              Object.keys(s).includes("added"),
              untrack(() => s.list.length),
              deep(s).count
            ]),
          () => {}
        );
      });
      flush();
      frames.length = 0;
      const update = action(function* () {
        setS(d => {
          d.count = 1;
          d.added = 5;
          d.list.push(2);
        });
        yield new Promise<void>(() => {});
      });
      update();
      await settle();
      // The recompute under the transaction saw one world.
      expect(frames).toEqual([[1, 1, true, true, 2, 1]]);
      // Outside it, the hold is foreign: committed.
      expect([s.count, "added" in s, deep(s).count]).toEqual([0, false, 0]);
    });

    it("a same-tick plain write (no transaction) keeps the snapshot peek", () => {
      const [s, setS] = createStore({ a: 1 });
      setS(d => {
        d.a = 3;
      });
      expect(snapshot(s).a).toBe(3);
      expect(s.a).toBe(1);
      flush();
      expect(s.a).toBe(3);
    });
  });
});
