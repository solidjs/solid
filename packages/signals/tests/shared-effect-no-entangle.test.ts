import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
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

// A15 reveal corollary: parallel transactions, effects don't entangle. A
// render effect groups whatever bindings the compiler put in one hole; a
// write that dirties it belongs to whoever made the write, and only a pass
// that actually OBSERVES another transaction's flight (reads it pending) joins
// that transaction. A pass whose stale input is served committed (the reveal
// carve-out) observes nothing and publishes on its own.
describe("a shared render effect does not entangle an unrelated sync write with a held flight", () => {
  // #3407: the counter increments through a held effect whether the write is
  // plain or made inside an action. Before, the action's transaction was
  // merged into the effect's stamp at the head of recompute — before the pass
  // ran, so before anything could have been observed — and both increments
  // waited on the flight (0:0 → 2:1).
  it.each(["plain", "action"])(
    "#3407 %s write publishes at once beside the pending binding",
    async kind => {
      reset();
      const log: string[] = [];
      const when: number[] = [];
      let setA!: (v: number) => void;
      let bump!: () => unknown;
      createRoot(() => {
        const [a, sA] = createSignal(0);
        const [b, setB] = createSignal(0);
        setA = sA;
        const detailsA = createMemo(() => (a() ? delay(2000, a()) : 0));
        const inc = () => setB(p => p + 1);
        bump =
          kind === "action"
            ? action(function* () {
                inc();
              })
            : inc;
        text(() => `${b()}:${detailsA()}`, log, when);
      });
      flush();
      await settle();
      setA(1);
      await settle();
      await advanceTo(500);
      bump();
      await settle();
      await advanceTo(1000);
      bump();
      await settle();
      await advanceTo(4000);
      expect(frames(log, when)).toEqual(["0: 0:0", "500: 1:0", "1000: 2:0", "2000: 2:1"]);
    }
  );

  // The carve-out itself, plain or in an action: a reveal that lands on the
  // foreign-held flight shows its committed value (coherent with the held
  // input's committed value) and catches up at the landing.
  it.each(["plain", "action"])(
    "a %s write that reveals the pending binding carves out and catches up",
    async kind => {
      reset();
      const log: string[] = [];
      const when: number[] = [];
      let setA!: (v: number) => void;
      let reveal!: () => unknown;
      createRoot(() => {
        const [a, sA] = createSignal(0);
        const [show, setShow] = createSignal(false);
        setA = sA;
        const detailsA = createMemo(() => delay(2000, a()));
        const on = () => setShow(true);
        reveal =
          kind === "action"
            ? action(function* () {
                on();
              })
            : on;
        text(() => `A: ${detailsA()}`, log, when);
        text(() => `Show: ${show()}`, log, when);
        text(() => (show() ? `Details: ${detailsA()}` : "hidden"), log, when);
      });
      flush();
      await settle();
      await advanceTo(2500);
      setA(1);
      await settle();
      await advanceTo(3000);
      reveal();
      await settle();
      await advanceTo(6000);
      // The flight was started by the earlier write (2500); the reveal (3000)
      // shows the committed 0 and re-derives at its landing.
      expect(frames(log, when)).toEqual([
        "0: Show: false | hidden",
        "2000: A: 0",
        "3000: Details: 0 | Show: true",
        "4500: A: 1 | Details: 1"
      ]);
    }
  );
});
