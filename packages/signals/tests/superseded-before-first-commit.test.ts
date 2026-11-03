/**
 * A18 (d) before the node's first commit.
 *
 * An optimistic computed whose FIRST landing was held — a downstream async
 * memo read it, opened a reveal, and never landed — has no committed value
 * (`_value` undefined, STATUS_UNINITIALIZED) when an action later re-asks
 * its source, and its own source lands a differing truth. Found by the
 * visibility oracle.
 *
 * Ruled 2026-11-03 (#4656, RULES-DERIVED D-34): "if it hadn't landed it
 * isn't optimistic, its loading". Nothing has committed, so the screen is
 * still loading, and an override here is a write before load: in DEV the
 * setter throws OPTIMISTIC_WRITE_BEFORE_LOAD and no guess is made. (Before
 * the ruling the guess was written and voided at the correction, as its
 * lane never showed; the reads below were the same.) What stays pinned: the
 * node, never committed, has nothing to serve a direct read (A19 exc. 1:
 * loading, not pending), and `latest` tunnels to the arrived truth (A18 d).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  NotReadyError,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function graph() {
  const holds: Array<() => void> = [];
  const never = () => new Promise<never>(r => holds.push(r as () => void));
  const [value, setValue] = createSignal(0);
  const fetches: Array<() => void> = [];
  const flights: Array<() => void> = [];
  let x!: () => number;
  let setX!: (v: number) => void;
  createRoot(() => {
    [x, setX] = createOptimistic(() => {
      const v = value();
      return new Promise<number>(r => fetches.push(() => r(v * 2)));
    });
    const downstream = createMemo(() => {
      const n = x();
      return new Promise<string>(r => flights.push(() => r(`${n}!`)));
    });
    createRenderEffect(downstream, () => {});
  });
  return {
    x,
    setX,
    setValue,
    fetches,
    flights,
    never,
    async release() {
      for (const r of holds.splice(0)) r();
      for (const f of flights.splice(0)) f();
      await settle();
      await settle();
    }
  };
}

describe("A18 (d) before the first commit", () => {
  it("an override before the first commit is OPTIMISTIC_WRITE_BEFORE_LOAD; the arrival is latest's, and isPending reads false", async () => {
    const g = graph();
    flush();
    g.fetches.shift()!(); // x's first landing (0) — held by the downstream reveal, which never lands
    await settle();
    let diagnosed: unknown;
    action(function* () {
      g.setValue(1);
      try {
        g.setX(3); // a write before load (ruled 2026-11-03): no guess
      } catch (e) {
        diagnosed = e;
      }
      yield g.never();
    })();
    flush();
    g.fetches.shift()!(); // own source lands 2 ≠ 3
    await settle();
    expect(String(diagnosed)).toMatch(/OPTIMISTIC_WRITE_BEFORE_LOAD/);
    // Never committed, the node has nothing to serve a direct read (A19
    // exc. 1: loading, not pending); `latest` tunnels to the staged truth.
    expect(() => g.x()).toThrow(NotReadyError);
    expect(latest(g.x)).toBe(2); // the arrived truth (A18 d)
    expect(isPending(g.x)).toBe(false); // loading, not pending (A19 exc. 1)
    await g.release();
  });
});
