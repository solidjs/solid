/**
 * #3078: memos over `isPending(source)` must read consistently during an
 * action-held transition.
 *
 * Resolved semantics:
 * - Untracked reads are idempotent: reading a memo never changes what the
 *   next read answers. (The old inline dispose-on-read made each untracked
 *   read of an ownerless memo tear the node down and the next read revive it
 *   with a full recompute in the ambient transition context, so consecutive
 *   reads oscillated false/true/false with no write in between.)
 * - Memo caches are flush-consistent: mid-tick untracked reads may serve the
 *   last-flushed verdict (a memo created before the write can read false
 *   until the next flush). This is uniform with every other memo.
 * - After a flush, while the action still holds the transition, every memo
 *   recompute agrees with a direct isPending() probe: pending is true for
 *   the whole action window. (The fresh-read pairing rule #2831/#3028 must
 *   not suppress the verdict while an action is still running — the staged
 *   value is an input, not a landed answer awaiting reveal.)
 * - Once the transition settles, everything reads false.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isPending,
  runWithOwner,
  untrack
} from "../src/index.js";
import type { Owner } from "../src/index.js";

afterEach(() => flush());

function holdTransition() {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const act = action(function* () {
    yield gate;
  });
  return { act, release };
}

describe("isPending memo consistency (#3078)", () => {
  it("untracked reads of an ownerless memo are idempotent across an action call", async () => {
    const { act, release } = holdTransition();
    const [count, setCount] = createSignal(0);

    // Ownerless -> observation lifecycle (CONFIG_AUTO_DISPOSE). This is the
    // reported repro shape: reads used to dispose+revive the node each time.
    const m = createMemo(() => isPending(count));

    setCount(v => v + 1);
    const done = act() as Promise<unknown>;

    const r1 = untrack(m);
    const r2 = untrack(m);
    const r3 = untrack(m);

    try {
      // Mid-tick the memo serves its last-flushed verdict (false — created
      // before the write); what matters is that reads do not flip it.
      expect(r1).toBe(false);
      expect(r2).toBe(r1);
      expect(r3).toBe(r1);
      expect(isPending(count)).toBe(true);
    } finally {
      release();
      await done;
      flush();
    }
    expect(untrack(m)).toBe(false);
    expect(isPending(count)).toBe(false);
  });

  it("after a flush mid-action, memos agree with the direct probe (pending)", async () => {
    const { act, release } = holdTransition();
    const [count, setCount] = createSignal(0);

    let owner!: Owner;
    let m1!: () => boolean;
    const dispose = createRoot(d => {
      owner = getOwner()!;
      // m1: created before the transition starts
      m1 = createMemo(() => isPending(count));
      return d;
    });
    const mOwnerless = createMemo(() => isPending(count));

    setCount(v => v + 1);
    // m2: created after the write; its creation compute reads the live verdict
    const m2 = runWithOwner(owner, () => createMemo(() => isPending(count)))!;
    expect(untrack(m2)).toBe(true);

    const done = act() as Promise<unknown>;
    flush(); // what the browser render loop does while the action runs

    try {
      expect(isPending(count)).toBe(true);
      expect(untrack(m1)).toBe(true);
      expect(untrack(m2)).toBe(true);
      // The ownerless memo was swept dormant at the flush; this read revives
      // it and the revival compute must agree with the direct probe too.
      expect(untrack(mOwnerless)).toBe(true);
    } finally {
      release();
      await done;
      flush();
      dispose();
    }
  });

  it("a memo recomputing for an unrelated dep mid-action still reports pending", async () => {
    const { act, release } = holdTransition();
    const [count, setCount] = createSignal(0);
    const [other, setOther] = createSignal(0);

    let m!: () => boolean;
    const dispose = createRoot(d => {
      m = createMemo(() => {
        other();
        return isPending(count);
      });
      return d;
    });

    setCount(v => v + 1);
    const done = act() as Promise<unknown>;
    flush();
    expect(untrack(m)).toBe(true);

    // An unrelated dep change forces a plain (non-lane) recompute while the
    // action still holds the transition. The compute reads count's staged
    // value; the fresh-read pairing rule must not tell it "not pending"
    // while a direct probe says pending (#3028 boundary).
    setOther(1);
    flush();

    try {
      expect(isPending(count)).toBe(true);
      expect(untrack(m)).toBe(true);
    } finally {
      release();
      await done;
      flush();
      dispose();
    }
  });

  it("after the transition settles every reading agrees on false", async () => {
    const { act, release } = holdTransition();
    const [count, setCount] = createSignal(0);

    let owner!: Owner;
    let m1!: () => boolean;
    const dispose = createRoot(d => {
      owner = getOwner()!;
      m1 = createMemo(() => isPending(count));
      return d;
    });

    setCount(v => v + 1);
    const m2 = runWithOwner(owner, () => createMemo(() => isPending(count)))!;

    const done = act() as Promise<unknown>;
    release();
    await done;
    flush();

    expect(count()).toBe(1);
    expect(isPending(count)).toBe(false);
    expect(untrack(m1)).toBe(false);
    expect(untrack(m2)).toBe(false);
    dispose();
  });

  it("dormancy sweep still reclaims ownerless memos (revival reads fresh values)", () => {
    const [count, setCount] = createSignal(1);
    const m = createMemo(() => count() * 2);

    expect(untrack(m)).toBe(2);
    setCount(2);
    // Mid-tick the cache is flush-consistent (uniform with observed memos).
    expect(untrack(m)).toBe(2);
    flush(); // recomputes (marked dirty), then the sweep unlinks the memo

    // Post-sweep the memo is dormant: this write no longer notifies it...
    setCount(5);
    flush();
    // ...so a correct fresh answer here proves the read revived it (the
    // pay-for-use contract survives the deferred sweep).
    expect(untrack(m)).toBe(10);
  });
});
