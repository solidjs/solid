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

// Two flights in one graph, in flight at once (A15: async work observed by a
// shared reader settles as one unit). The #3442 arm — a probe's pull must not
// break the slower flight's hold — is pinned in ispending-combined-atomic-3442.
describe("overlapping flights", () => {
  // #3443: `setA` opens T1 (a in flight, `sum` held pending on it); `setB` 500ms
  // later starts b's flight, whose pending PROPAGATES onto `sum` — no recompute
  // (its inputs' values are unchanged), so the memo's stamped re-entry never
  // ran and T1 never learned it was waiting on b. a landed first, T1 revealed
  // `A: 1` beside the committed `Sum: 0`, and `Sum: 2` arrived with `B: 1`.
  // A held memo made pending by another flight entangles the two at the
  // propagation (A15): one reveal, when both have landed.
  it("#3443 a shared memo entangles two flights that overlap", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void, setB!: (v: number) => void;
    createRoot(() => {
      const [inputA, sa] = createSignal(0);
      const [inputB, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      const a = createMemo(() => delay(1000, inputA()));
      const b = createMemo(() => delay(1000, inputB()));
      const sum = createMemo(() => a() + b());
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${b()}`, log, when);
      text(() => `Sum: ${sum()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    setA(1);
    await settle();
    await advanceTo(2500);
    setB(1);
    await settle();
    await advanceTo(6000);
    expect(frames(log, when)).toEqual(["1000: A: 0 | B: 0 | Sum: 0", "3500: A: 1 | B: 1 | Sum: 2"]);
  });

  // The effect arm stays parallel (A15 shared-hole corollary, #3407): the same
  // sum written as a plain expression in the hole is a stale reader of b's
  // flight, served the committed 0, and publishes `Sum: 1` with a's landing.
  it("a shared render effect stays parallel: each flight reveals at its own landing", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void, setB!: (v: number) => void;
    createRoot(() => {
      const [inputA, sa] = createSignal(0);
      const [inputB, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      const a = createMemo(() => delay(1000, inputA()));
      const b = createMemo(() => delay(1000, inputB()));
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${b()}`, log, when);
      text(() => `Sum: ${a() + b()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    setA(1);
    await settle();
    await advanceTo(2500);
    setB(1);
    await settle();
    await advanceTo(6000);
    expect(frames(log, when)).toEqual([
      "1000: A: 0 | B: 0 | Sum: 0",
      "3000: A: 1 | Sum: 1",
      "3500: B: 1 | Sum: 2"
    ]);
  });

  // The write that starts the second flight is held with the first (its async
  // work flows into the held memo): `page` is read plainly by `Sum`, but
  // `details` — held pending on count=1's flight — now depends on `pageData`'s.
  // Before, page=1 committed ambient (`Sum: 1`) and details was re-asked under
  // the hold once pageData landed.
  it("#3443 the second flight's own write is held with the first", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void, setPage!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [page, sp] = createSignal(0);
      setCount = sc;
      setPage = sp;
      const pageData = createMemo(() => delay(1000, page()));
      const details = createMemo(() => delay(2000, pageData() + count()));
      text(() => `Sum: ${page() + count()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3500);
    setCount(1);
    await settle();
    await advanceTo(4000);
    setPage(1);
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Sum: 0",
      "3000: Details: 0",
      // pageData1 lands at 5000 and re-asks details (due 7000) under the hold.
      "7000: Details: 2 | Sum: 2"
    ]);
  });
});
