import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

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

async function scenario(variant: "issue" | "no-pending" | "getter") {
  now = 0;
  timers = [];
  const log: string[] = [];
  const when: number[] = [];
  let setCount!: (v: number) => void;
  createRoot(() => {
    const [count, sC] = createSignal(0);
    setCount = sC;
    const slow = createMemo(() => delay(1000, count()));
    const fast = createMemo(async () => count());
    const copy = variant === "getter" ? () => slow() : createMemo(() => slow());
    if (variant !== "no-pending")
      text(() => `Pending: ${isPending(() => [fast(), copy()])}`, log, when);
    text(() => `Fast: ${fast()}`, log, when);
    text(() => `Slow: ${copy()}`, log, when);
  });
  flush();
  await settle();
  await advanceTo(2000);
  setCount(1);
  await settle();
  await advanceTo(5000);
  return frames(log, when);
}

describe("combined isPending read across two async memos (#3442)", () => {
  // The write (2000) starts two flights; `fast` lands in a microtask and is
  // held with `slow` (1000ms). The probe effect carries the companion lane of
  // the pending signals it reads, and its pull of `copy` (a sync memo over
  // `slow`) used to run under that lane, where a pending node on no lane
  // serves its committed value instead of throwing: `copy` published a
  // stale settled `0`, dropped its pending status, and its readers stopped
  // holding `slow` — the hold released with `slow` still in flight
  // (`Fast: 1` beside `Slow: 0`, `Pending: false`). A memo now computes
  // under its own lane posture only.
  const atomic = [
    "1000: Fast: 0 | Pending: false | Slow: 0",
    "2000: Pending: true",
    "3000: Fast: 1 | Pending: false | Slow: 1"
  ];
  it("A31 / #3442 isPending(() => [fast(), copy()]) with copy a sync memo holds both flights", async () => {
    expect(await scenario("issue")).toEqual(atomic);
  });
  it("control: copy is a plain getter", async () => {
    expect(await scenario("getter")).toEqual(atomic);
  });
  it("control: no pending read", async () => {
    expect(await scenario("no-pending")).toEqual([
      "1000: Fast: 0 | Slow: 0",
      "3000: Fast: 1 | Slow: 1"
    ]);
  });
});
