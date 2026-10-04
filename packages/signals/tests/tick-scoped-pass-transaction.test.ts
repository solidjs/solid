/**
 * Membership in a hold is the tick's (ruling 1, one frame concept; maintainer
 * ruling 2026-10-04, surfaced by #3761's review). A mainline pass outside a
 * flush joins the transaction of what it read through `passTx` — "the entry
 * is the pass's alone" (A29, creation-time form) scopes the entry away from
 * the tick's OTHER writes, not from the tick's other passes: `passTx` is one
 * per tick, and a second pass in the same tick that reads a DIFFERENT foreign
 * hold merges that hold into it (`joinPassTx` → `merge`). The tick is one
 * synchronous frame, and a frame that derives from two futures waits on
 * both. A15's "writes on fully disjoint graphs keep independent transitions"
 * is about writes in different ticks: the same two mounts in two ticks are
 * two frames, each born held into its own hold, and the first reveals at its
 * own release.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function hold(write: () => void) {
  let release!: () => void;
  const run = action(function* () {
    write();
    yield new Promise<void>(resolve => (release = resolve));
  });
  run();
  flush();
  return release;
}

function twoHolds() {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const releaseA = hold(() => setA(1));
  const releaseB = hold(() => setB(2));
  const shownA: number[] = [];
  const shownB: number[] = [];
  const mountA = () =>
    createRoot(() => createRenderEffect(createMemo(a), v => void shownA.push(v)));
  const mountB = () =>
    createRoot(() => createRenderEffect(createMemo(b), v => void shownB.push(v)));
  return { a, b, releaseA, releaseB, shownA, shownB, mountA, mountB };
}

describe("membership in a hold is the tick's (ruling 1; `passTx` is tick-scoped)", () => {
  it("two mainline mounts in ONE tick over two different foreign holds merge them: both reveal at the second release", async () => {
    const h = twoHolds();
    h.mountA();
    h.mountB();
    flush();
    // Both born held (A29); nothing shows.
    expect(h.shownA).toEqual([]);
    expect(h.shownB).toEqual([]);
    expect([isPending(h.a), isPending(h.b)]).toEqual([true, true]);

    h.releaseA();
    await tick();
    // One frame derived from both futures: `a`'s hold merged into `b`'s and
    // waits for it — `a` is still held, still pending.
    expect(h.a()).toBe(0);
    expect(h.b()).toBe(0);
    expect(h.shownA).toEqual([]);
    expect(h.shownB).toEqual([]);
    expect([isPending(h.a), isPending(h.b)]).toEqual([true, true]);

    h.releaseB();
    await tick();
    expect([h.a(), h.b()]).toEqual([1, 2]);
    expect(h.shownA).toEqual([1]);
    expect(h.shownB).toEqual([2]);
    expect([isPending(h.a), isPending(h.b)]).toEqual([false, false]);
  });

  it("the same two mounts in SEPARATE ticks stay independent: the first reveals at its own release", async () => {
    const h = twoHolds();
    h.mountA();
    flush();
    h.mountB();
    flush();
    expect(h.shownA).toEqual([]);
    expect(h.shownB).toEqual([]);
    expect([isPending(h.a), isPending(h.b)]).toEqual([true, true]);

    h.releaseA();
    await tick();
    // Two frames, two holds: `a` lands alone, `b` stays held.
    expect(h.a()).toBe(1);
    expect(h.b()).toBe(0);
    expect(h.shownA).toEqual([1]);
    expect(h.shownB).toEqual([]);
    expect([isPending(h.a), isPending(h.b)]).toEqual([false, true]);

    h.releaseB();
    await tick();
    expect(h.b()).toBe(2);
    expect(h.shownB).toEqual([2]);
    expect(isPending(h.b)).toBe(false);
  });
});
