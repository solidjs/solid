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

// A15 reveal corollary, first-observer arm (#3458): `count=1` opens T1 holding
// on `a` (its reader observed it); `b`'s flight is up too but nobody reads it.
// `show` flips mainline and B reads `b` as a stale reader of T1 — served the
// committed `0`, coherent with the frame. It is the flight's FIRST observer:
// T1 held no entry for `b`, the join found nothing, and T1 — judged complete
// on `a` alone — revealed `Count: 1 | A: 1` beside `B: 0`. The observation is
// now notified up the reader's queue chain under T1 (INV-3: the one
// registration site), and T1 waits for `b`.
describe("a stale reader that is a flight's first observer registers it (#3458)", () => {
  it("revealing a pending memo holds the transaction on it", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [show, ss] = createSignal(false);
      setCount = sc;
      setShow = ss;
      const a = createMemo(() => delay(1000, count()));
      const b = createMemo(() => delay(2000, count()));
      text(() => `Count: ${count()}`, log, when);
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${show() ? b() : "hidden"}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    setCount(1);
    await settle();
    await advanceTo(3500);
    setShow(true);
    await settle();
    await advanceTo(9000);
    expect(frames(log, when)).toEqual([
      "0: B: hidden | Count: 0",
      "1000: A: 0",
      "3500: B: 0",
      "5000: A: 1 | B: 1 | Count: 1"
    ]);
  });
});
