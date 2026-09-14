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
  onSettled
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

describe("onSettled during an optimistic revert", () => {
  // The settle drops the override in the commit pass and only enqueues the
  // subscribers; the pass after re-derives them. An unowned onSettled fired in
  // the commit pass read `value` reverted beside `copy` still holding 1 (reads
  // do not pull). The fire now waits for the heap to drain.
  it("#3411 reads the optimistic source and a sync memo of it consistently", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => Promise<void>;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const [snapshot, setSnapshot] = createSignal("not called");
      const copy = createMemo(() => value());
      run = action(function* () {
        setValue(1);
        onSettled(() => {
          setSnapshot(`Value: ${value()}, Copy: ${copy()}`);
        });
        yield delay(1000);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Copy: ${copy()}`, log, when);
      text(() => `Snap: ${snapshot()}`, log, when);
    });
    flush();
    await settle();
    run();
    await settle();
    await advanceTo(3000);
    expect(frames(log, when)).toEqual([
      "0: Copy: 0 | Copy: 1 | Snap: not called | Value: 0 | Value: 1",
      "1000: Copy: 0 | Snap: Value: 0, Copy: 0 | Value: 0"
    ]);
  });

  // Same tear without an action: the ambient optimistic write reverts at the
  // end of its own flush and re-derives on the next pass.
  it("#3411 also without an action", () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let write!: () => void;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const [snapshot, setSnapshot] = createSignal("not called");
      const copy = createMemo(() => value());
      write = () => {
        setValue(1);
        onSettled(() => {
          setSnapshot(`Value: ${value()}, Copy: ${copy()}`);
        });
      };
      text(() => `Value: ${value()}`, log, when);
      text(() => `Copy: ${copy()}`, log, when);
      text(() => `Snap: ${snapshot()}`, log, when);
    });
    flush();
    write();
    flush();
    expect(log.at(-1)).toBe("Snap: Value: 0, Copy: 0");
  });
});

describe("isPending() over several async siblings of an optimistic value", () => {
  it("#3409 a combined probe reports pending while either read is pending", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => Promise<void>;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const a = createMemo(() => delay(1000, value()));
      const b = createMemo(() => delay(2000, value()));
      run = action(function* () {
        setValue(1);
        yield delay(3000);
      });
      text(() => `A: ${isPending(a)}`, log, when);
      text(() => `B: ${isPending(b)}`, log, when);
      text(() => `Combined: ${isPending(() => [a(), b()])}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    run();
    await settle();
    await advanceTo(9000);
    // Optimistic phase (3000–5000): every indicator flips with its own
    // reads. The revert (6000) reloads the truth as an ordinary held
    // transaction, so the indicators clear together when it commits (8000),
    // exactly as they do for a plain signal write.
    expect(frames(log, when)).toEqual([
      "2000: A: false | B: false | Combined: false",
      "3000: A: true | B: true | Combined: true",
      "4000: A: false",
      "5000: B: false | Combined: false",
      "6000: A: true | B: true | Combined: true",
      "8000: A: false | B: false | Combined: false"
    ]);
  });
});
