/**
 * A18 (d) before the node's first commit.
 *
 * An optimistic computed whose FIRST landing was held — a downstream async
 * memo read it, opened a reveal, and never landed — has no committed value
 * (`_value` undefined, STATUS_UNINITIALIZED) when an action later writes an
 * override and its own source lands a differing truth. The override is the
 * observable value, so the verdict is "the arrival differs" (A18 d); the
 * uninitialized suppression is A19 exception (1), whose premise — no
 * observable value — an override defeats. Found by the visibility oracle.
 */
import { describe, expect, it } from "vitest";
import {
  action,
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
  it("isPending reads true when the arrival differs from the override, although the node never committed", async () => {
    const g = graph();
    flush();
    g.fetches.shift()!(); // x's first landing (0) — held by the downstream reveal, which never lands
    await settle();
    action(function* () {
      g.setValue(1);
      g.setX(3); // wrong guess; the truth will be 2
      yield g.never();
    })();
    flush();
    g.fetches.shift()!(); // own source lands 2 ≠ 3
    await settle();
    expect(g.x()).toBe(3); // the displayed override (A18 c)
    expect(latest(g.x)).toBe(2); // the arrived truth (A18 d)
    expect(isPending(g.x)).toBe(true); // it differs
    await g.release();
  });
});
