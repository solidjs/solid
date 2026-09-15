import { describe, expect, it } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

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
    const due = timers.filter(x => x.at <= t).sort((a, b) => a.at - b.at);
    if (!due.length) break;
    const next = due[0];
    timers = timers.filter(x => x !== next);
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
function text(fn: () => string, log: string[], when: number[]) {
  createRenderEffect(fn, v => {
    log.push(v);
    when.push(now);
  });
}
function frames(log: string[], when: number[]) {
  const m = new Map<number, string[]>();
  log.forEach((l, i) => {
    (m.get(when[i]) ?? m.set(when[i], []).get(when[i])!).push(l);
  });
  return [...m].map(([t, ls]) => `${t}: ${ls.sort().join(" | ")}`);
}

// A30: dependencies are the committed frame's until it is replaced. A pass
// that changed nothing replaced nothing either (#3469): `selected = b() ? b()
// : a()` computed `1` from the held `b=1`, equal to the `1` it had from `a`,
// and trimmed `a` at its tail — but the flush parked (b's flight is observed),
// the committed frame still derives from `a`, and the mainline `a=2` never
// reached it: `A: 2 | B: 0 | Selected: 1`. The trim now waits on the flush's
// verdict: trimmed when it commits, kept when it parks.
describe("an unchanged pass keeps the committed frame's dependencies (A30, #3469)", () => {
  it("a memo whose held pass computed the same value still follows its committed inputs", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(1);
      const [b, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      const slow = createMemo(() => delay(2000, b()));
      const selected = createMemo(() => (b() ? b() : a()));
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${b()}`, log, when);
      text(() => `Loaded B: ${slow()}`, log, when);
      text(() => `Selected: ${selected()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    setB(1);
    await settle();
    await advanceTo(3500);
    setA(2);
    await settle();
    await advanceTo(9000);
    // `selected` re-derives on the write and is served b's staged value, so it
    // enters the hold (A29) and `a=2` is held with `b` — the #3443 consequence:
    // the write whose derivation flows into a held memo is held with it.
    expect(frames(log, when)).toEqual([
      "0: A: 1 | B: 0 | Selected: 1",
      "2000: Loaded B: 0",
      "5000: A: 2 | B: 1 | Loaded B: 1"
    ]);
  });

  // Effect arm: a render effect is a stale reader — served the committed `b`,
  // it publishes `2` at once (a sync write is never held by a transaction)
  // and re-derives at the commit. The memo above, served the staged `b`,
  // enters the transaction instead (A29) and holds `a=2` with it.
  it("a render effect whose held pass computed the same value follows its inputs at once", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(1);
      const [b, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      const slow = createMemo(() => delay(2000, b()));
      text(() => `Loaded B: ${slow()}`, log, when);
      text(() => `Selected: ${b() ? b() : a()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    setB(1);
    await settle();
    await advanceTo(3500);
    setA(2);
    await settle();
    await advanceTo(9000);
    expect(frames(log, when)).toEqual([
      "0: Selected: 1",
      "2000: Loaded B: 0",
      "3500: Selected: 2",
      "5000: Loaded B: 1 | Selected: 1"
    ]);
  });
});
