/**
 * Posture matrix pins (visibility-oracle-posture.test.ts is the discovery
 * runner; these are the cells brought to a ruling, 2026-09-15).
 *
 * A — same-tick adoption is BY DESIGN: transitions are ambient; an action is
 *     the special case that links one across async, and every write is a
 *     conceptual transition. An action started later in the same tick owns
 *     the ambient writes made before it.
 * C — latest() ENTANGLES (A15): optimistic lanes are transition-bound, so a
 *     latest() read inside another live action merges that action with the
 *     source's — "that doesn't mean optimism for both can't poke through in
 *     the meanwhile": the value is served immediately, the reveal is joint.
 * B — creation under a transaction ESCAPES the hold (spec O2, recorded as
 *     current behavior, not ruled): a memo + render effect created inside a
 *     live action over a value another action holds direct-commits and
 *     publishes the held value while untracked reads keep the committed
 *     frame. "Generally creation escapes because it isn't visible" — the
 *     matrix shows the creation's own effect does publish; kept as is
 *     ("capture things as they are", 2026-09-15). A change here flips the
 *     pin loudly and is a design decision.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

/** `x` held at 1 by action T (yields until `release`). */
function heldByAction() {
  const [x, setX] = createSignal(0);
  let release!: () => void;
  const run = action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  });
  run();
  flush();
  expect(x()).toBe(0);
  return { x, release };
}

describe("A — same-tick adoption is by design: transitions are ambient (posture matrix, ruled 2026-09-15)", () => {
  it("an action started after an ambient write in the same tick owns that write; it reveals with the action", async () => {
    const [x, setX] = createSignal(0);
    setX(1); // ambient, unflushed
    let release!: () => void;
    const run = action(function* () {
      yield new Promise<void>(r => (release = r));
    });
    run();
    flush();
    expect(x()).toBe(0); // adopted: held with the action, not committed by the flush
    release();
    await tick();
    expect(x()).toBe(1);
  });
});

describe("C — latest() entangles: lanes are transition-bound (A15, ruled 2026-09-15)", () => {
  it("latest(x) inside another live action serves the held value now and merges that action with x's transaction", async () => {
    const { x, release } = heldByAction();
    const [y, setY] = createSignal(0);
    let seen: number | undefined;
    let releaseU!: () => void;
    const runU = action(function* () {
      setY(1);
      seen = latest(x); // optimism pokes through immediately …
      yield new Promise<void>(r => (releaseU = r));
    });
    runU();
    flush();
    expect(seen).toBe(1);
    release(); // … but T alone no longer reveals: U and T settle as one
    await tick();
    expect(x()).toBe(0);
    expect(y()).toBe(0);
    releaseU();
    await tick();
    expect(x()).toBe(1);
    expect(y()).toBe(1);
  });
});

describe("B — creation under a transaction escapes the hold (OBSERVED, spec O2; not a ruling)", () => {
  it("a memo + render effect created inside another live action over a held value publishes the held value; the frame keeps the committed one until both actions settle", async () => {
    const { x, release } = heldByAction();
    const [y, setY] = createSignal(0);
    const published: number[] = [];
    let releaseU!: () => void;
    const runU = action(function* () {
      setY(1);
      createRoot(() => {
        const m = createMemo(() => x());
        createRenderEffect(m, v => {
          published.push(v);
        });
      });
      yield new Promise<void>(r => (releaseU = r));
    });
    runU();
    flush();
    expect(published).toEqual([1]); // observed: the creation direct-committed the held value
    expect(x()).toBe(0); // while the frame reads committed
    release(); // the creation derived from T's world, so U merged into T (A15): T alone does not reveal
    await tick();
    expect(x()).toBe(0);
    releaseU();
    await tick();
    expect(x()).toBe(1);
    expect(published).toEqual([1]);
  });
});

describe("P1 — a reader that stopped reading the flight does not keep its hold (fuzzer #3446 P1; A15 / #3426 live reporter)", () => {
  // Reduced from fuzzer case 854 (seed 3289) and the posture matrix's
  // `effect × gatedAway` cell on the "observed only by the matrix reader"
  // state. A render effect DIRECTLY observing an uninitialized async memo
  // registers as the flight's reporter; when it re-runs without reading the
  // memo (gate closed) nothing visible needs the unresolved answer, yet the
  // source's ordinary write stays held — forever, since the flight never
  // lands. The predicate (`reporterBlocksSource`) already judged the effect
  // dead after its re-run; nothing RE-JUDGED the parked transaction — the
  // flush that re-ran the effect had no active transaction. Fixed at
  // recompute's tail: a pending reporter that recovers without its flight
  // landing wakes the transaction it reported to (wokenTransitions — the
  // third site after disposal #3372 and boundary reset #3375).
  it("gating a render effect away from a never-landing memo releases the source's write", async () => {
    const [s, setS] = createSignal(0);
    const [show, setShow] = createSignal(true);
    const published: unknown[] = [];
    createRoot(() => {
      const m = createMemo(() => {
        s();
        return new Promise<number>(() => {}); // never lands
      });
      createRenderEffect(
        () => (show() ? m() : "hidden"),
        v => {
          published.push(v);
        }
      );
    });
    flush();
    setS(1);
    flush();
    expect(s()).toBe(0); // held by the observed flight — correct
    setShow(false);
    flush();
    await tick();
    expect(published).toEqual(["hidden"]); // the reader re-ran and no longer derives from m
    expect(s()).toBe(1); // P1: nothing visible still needs the answer — publish
  });
});

describe("P1, same-flush form — gate and write in ONE flush (fuzzer #3446 case 21; spec O3)", () => {
  // The effect's pass runs under the transaction and STAGES "hidden", so A30
  // keeps its previous dep on the memo linked past `_depsTail` until the
  // commit trims it. `reporterBlocksSource`'s deps scan read that kept dep and
  // called the effect live — the hold kept the dep that kept the hold. The
  // scan is now bounded at `_depsTail`: "still derives from the source" is a
  // question about this pass's reads, not the committed frame's.
  it("closing the gate and writing the source in one flush releases the write", async () => {
    const [s, setS] = createSignal(0);
    const [show, setShow] = createSignal(true);
    createRoot(() => {
      const m = createMemo(() => {
        s();
        return new Promise<number>(() => {});
      });
      createRenderEffect(
        () => (show() ? m() : "hidden"),
        () => {}
      );
    });
    flush();
    setShow(false);
    setS(1);
    flush();
    await tick();
    expect(s()).toBe(1);
  });
});
