import { describe, expect, it } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

// Manual clock (see async-chain-supersession.test.ts).
let now = 0;
let timers: { at: number; run: () => void }[] = [];
function delay<T>(ms: number, value?: T): Promise<T> {
  return new Promise<T>(r => timers.push({ at: now + ms, run: () => r(value as T) }));
}
async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}
async function advanceTo(t: number) {
  while (true) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > t) break;
    timers.shift();
    now = next.at;
    next.run();
    await settle();
  }
  now = t;
  await settle();
}
function reset() {
  now = 0;
  timers = [];
}
function frames(log: string[], when: number[]): string[] {
  const byTime = new Map<number, string[]>();
  log.forEach((v, i) => (byTime.get(when[i]) ?? byTime.set(when[i], []).get(when[i])!).push(v));
  return [...byTime].map(([t, vs]) => `${t}: ${vs.sort().join(" | ")}`);
}
function text(fn: () => string, log: string[], when: number[]) {
  let last: string | undefined;
  createRenderEffect(fn, v => {
    if (v !== last) {
      last = v;
      log.push(v);
      when.push(now);
    }
  });
}

// #3461: `selected = async () => (b() ? b() : a())`. `setB(1)` is held by `slow`;
// selected's held pass reads only `b` and its flight lands into the hold. The
// landing used to trim `a` at once, so the later mainline `setA(1)` never
// reached selected: `A: 1` committed beside `Selected: 0` while `B` still read
// 0. A30: the landed value is staged, the committed 0 still derives from `a`.
async function scenario(asyncSelected: boolean) {
  reset();
  const log: string[] = [];
  const when: number[] = [];
  let setA!: (v: number) => void;
  let setB!: (v: number) => void;
  createRoot(() => {
    const [a, sA] = createSignal(0);
    const [b, sB] = createSignal(0);
    setA = sA;
    setB = sB;
    const slow = createMemo(() => delay(2000, b()));
    const selected = asyncSelected
      ? createMemo(async () => (b() ? b() : a()))
      : createMemo(() => (b() ? b() : a()));
    text(() => `A: ${a()}`, log, when);
    text(() => `B: ${b()}`, log, when);
    text(() => `Slow: ${slow()}`, log, when);
    text(() => `Selected: ${selected()}`, log, when);
  });
  flush();
  await settle();
  await advanceTo(3000);
  setB(1);
  await settle();
  await advanceTo(3500);
  setA(1);
  await settle();
  await advanceTo(6000);
  return frames(log, when);
}

describe("async memo landing keeps the committed frame's dependencies", () => {
  it("A30 / #3461 a held async landing does not trim the input its committed value derives from", async () => {
    // The `a` write (3500) reaches selected through the dependency its
    // committed value still has, and joins the hold through selected's
    // stamp: one frame when slow lands, never `A: 1` beside `Selected: 0`.
    // (The async memo's first landing is held with the mount's slow flight
    // and reveals with it at 2000; the sync control publishes it at 0.)
    expect(await scenario(true)).toEqual([
      "0: A: 0 | B: 0",
      "2000: Selected: 0 | Slow: 0",
      "5000: A: 1 | B: 1 | Selected: 1 | Slow: 1"
    ]);
  });

  it("A30 / #3410 sync control: the same conditional as a plain memo", async () => {
    expect(await scenario(false)).toEqual([
      "0: A: 0 | B: 0 | Selected: 0",
      "2000: Slow: 0",
      "5000: A: 1 | B: 1 | Selected: 1 | Slow: 1"
    ]);
  });
});
