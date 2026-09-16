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

// A pass that re-parks on a new pending source drops the sources it stopped
// carrying from its dependents (#3456). Panel read `selected`, pending through
// `details`, so Panel recorded `details` as its root pending source; `count=2`
// switched `selected`'s branch — its new flight is its own promise, no longer
// through `details` — and Panel's pass re-threw on `selected`, but the stale
// `details` entry stayed. `selected` landed `0` (equal to its committed `0`,
// no value change) and retired only its own entry; `details`' landing walk
// reached `selected`, found nothing left to retire there, and stopped before
// Panel. Panel stayed pending forever on a source it had no path to.
describe("re-park retires the sources a pass stopped carrying (#3456)", () => {
  it("a conditional whose async branch was cancelled shows the settled world", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      setCount = sc;
      const details = createMemo(() => delay(1000, count()));
      const selected = createMemo(async () => (count() === 1 ? details() : 0));
      text(() => `Count: ${count()}`, log, when);
      text(() => `Panel: ${count() ? selected() : "hidden"}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    setCount(1);
    await settle();
    await advanceTo(2500);
    setCount(2);
    await settle();
    await advanceTo(8000);
    // `selected(2)` lands 0 in a microtask; nobody displays `details`, so its
    // superseding flight (lands 3500) holds nothing: one reveal at 2500.
    expect(frames(log, when)).toEqual(["0: Count: 0 | Panel: hidden", "2500: Count: 2 | Panel: 0"]);
  });

  // The sync twin recovers on its own: an errored pass keeps its dropped dep
  // linked, so the dropped source's landing still reaches the node. Pinned so
  // the async arm above cannot regress it (the sweep skips sources the new
  // pass still carries).
  it("a branch switch between two pending sources settles on the live one", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      setCount = sc;
      const x = createMemo(() => delay(1000, count()));
      const y = createMemo(() => delay(3000, count() * 10));
      const selected = createMemo(() => (count() === 1 ? x() : y()));
      text(() => `Count: ${count()}`, log, when);
      text(() => `Panel: ${selected()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(4000);
    setCount(1);
    await settle();
    await advanceTo(4500);
    setCount(2);
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Count: 0",
      "3000: Panel: 0",
      "7500: Count: 2 | Panel: 20"
    ]);
  });
});
