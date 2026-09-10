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
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
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
