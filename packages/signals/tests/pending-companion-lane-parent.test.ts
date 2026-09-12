import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  flush,
  isPending
} from "../src/index.js";

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

describe("isPending() of an async memo over an optimistic derivation", () => {
  // The companion's child lane takes its parent from the owner's lane at
  // creation. `details` is made pending by propagation (copy's flight) before
  // it rides the lane itself, and notifyStatus poked its companion before
  // assigning its lane: the companion lane was born parentless, the indicator
  // effect (which also depends on details) merged it into the held `value`
  // lane, and its run waited on the async it reports.
  it("#3379 isPending(details) is true while details loads the optimistic value through an async memo", async () => {
    now = 0;
    timers = [];
    const log: string[] = [];
    const when: number[] = [];
    let update!: () => Promise<void>;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const copy = createMemo(async () => value());
      const details = createMemo(() => delay(1000, copy()));
      update = action(function* () {
        setValue(1);
        yield delay(2000);
      });
      text(() => `View: ${value()} / ${details()}`, log, when);
      text(() => `Pending: ${isPending(details)}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    update();
    await settle();
    await advanceTo(6000);
    // The View effect reads details, so it holds the frame while details
    // loads (0 / 0 until the derivation lands); the indicator must not — it
    // rides the companion's child lane and reports the load as it starts,
    // exactly as it does during the revert (5000).
    expect(frames(log, when)).toEqual([
      "1000: Pending: false | View: 0 / 0",
      "3000: Pending: true",
      "4000: Pending: false | View: 1 / 1",
      "5000: Pending: true",
      "6000: Pending: false | View: 0 / 0"
    ]);
  });
});
