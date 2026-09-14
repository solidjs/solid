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

describe("conditional memo across a held branch change", () => {
  it("A29 / #3408 a memo that starts reading a held signal does not reveal its staged value", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    createRoot(() => {
      const [count, sC] = createSignal(0);
      const [show, sS] = createSignal(false);
      setCount = sC;
      setShow = sS;
      const details = createMemo(() => delay(1000, count()));
      const panel = createMemo(() => (show() ? count() : "hidden"));
      text(() => `Count: ${count()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
      text(() => `Panel: ${panel()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    setCount(1);
    await settle();
    await advanceTo(2500);
    setShow(true);
    await settle();
    await advanceTo(4000);
    // The `show` flip (2500) makes panel read count, whose write details
    // holds: panel derives from the held world, so it joins the hold instead
    // of publishing the staged 1 beside Count: 0. One frame at the landing.
    expect(frames(log, when)).toEqual([
      "0: Count: 0 | Panel: hidden",
      "1000: Details: 0",
      "3000: Count: 1 | Details: 1 | Panel: 1"
    ]);
  });

  it("A30 / #3410 a memo whose held pass trimmed an input still agrees with its committed inputs", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setFixed!: (v: boolean) => void;
    createRoot(() => {
      const [count, sC] = createSignal(0);
      const [fixed, sF] = createSignal(false);
      setCount = sC;
      setFixed = sF;
      const selected = createMemo(() => (fixed() ? 2 : count()));
      const details = createMemo(() => delay(1000, selected()));
      text(() => `Fixed: ${fixed()}`, log, when);
      text(() => `Count: ${count()}`, log, when);
      text(() => `Selected: ${selected()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    setFixed(true);
    await settle();
    await advanceTo(2500);
    setCount(1);
    await settle();
    await advanceTo(5000);
    // selected's held pass (fixed → true) stops reading count, but its
    // committed 0 still derives from count: the count write (2500) reaches it
    // and joins the hold — exactly what an unconditional count() read does —
    // instead of publishing Count: 1 beside Selected: 0 / Fixed: false.
    expect(frames(log, when)).toEqual([
      "0: Count: 0 | Fixed: false | Selected: 0",
      "1000: Details: 0",
      "3000: Count: 1 | Details: 2 | Fixed: true | Selected: 2"
    ]);
  });
});
