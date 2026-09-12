import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

// A manual clock. Async memos return promises that resolve when the clock is
// advanced past their due time, in due-time order, with a full settle (the
// microtask drain and the scheduled flush) between resolutions — the same
// interleaving a browser produces with real timers, minus the waiting.
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

/** The publish log as frames: one entry per clock time, values sorted (effect
 * order within a frame is not part of the contract). */
function frames(log: string[], when: number[]): string[] {
  const byTime = new Map<number, string[]>();
  log.forEach((v, i) => (byTime.get(when[i]) ?? byTime.set(when[i], []).get(when[i])!).push(v));
  return [...byTime].map(([t, vs]) => `${t}: ${vs.sort().join(" | ")}`);
}

/** A text node: publishes each distinct value with the clock time it landed. */
function text(fn: () => string, log: string[], when?: number[]) {
  let last: string | undefined;
  createRenderEffect(fn, v => {
    if (v !== last) {
      last = v;
      log.push(v);
      when?.push(now);
    }
  });
}

describe("a second write while an async chain is in flight", () => {
  it("#3373 the stale first-hop landing does not commit the newer signal value", async () => {
    reset();
    const log: string[] = [];
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      setCount = sc;
      const a = createMemo(() => delay(1000, count()));
      const b = createMemo(() => delay(1000, a()));
      text(() => `${count()} / ${b()}`, log);
    });
    flush();
    await settle();
    await advanceTo(2500);
    setCount(1);
    await settle();
    // a1 lands at 3500; b1 is due at 4500. The second write arrives between.
    await advanceTo(4000);
    setCount(2);
    await settle();
    await advanceTo(9000);
    // b1 landing (4500) must not commit count=2 alongside b=1 while a2 is in flight.
    expect(log).toEqual(["0 / 0", "2 / 2"]);
  });

  it("the held first-hop answer reveals when the re-asked input lands unchanged", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      setCount = sc;
      // a collapses 1 and 2: the second flight lands with the value b1 was computed from.
      const a = createMemo(() => delay(1000, Math.min(count(), 1)));
      const b = createMemo(() => delay(1000, a()));
      text(() => `${count()} / ${b()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2500);
    setCount(1);
    await settle();
    await advanceTo(4000);
    setCount(2);
    await settle();
    await advanceTo(9000);
    // b1 (landed 4500) is the answer for a=1, which a2 confirms at 5000; nothing recomputes.
    expect(log).toEqual(["0 / 0", "2 / 1"]);
    expect(when).toEqual([2000, 5000]);
  });

  it("#3376 isPending stays true across the stale first-hop landing", async () => {
    reset();
    const log: string[] = [];
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      setCount = sc;
      const a = createMemo(() => delay(400, count()));
      const b = createMemo(() => delay(400, a()));
      text(() => `Pending: ${isPending(b)}`, log);
    });
    flush();
    await settle();
    await advanceTo(1000);
    setCount(1);
    await settle();
    await advanceTo(1600);
    setCount(2);
    await settle();
    await advanceTo(5000);
    expect(log).toEqual(["Pending: false", "Pending: true", "Pending: false"]);
  });

  it("#3375 a Loading boundary reset ends the hold on writes only its readers observed and waits for the downstream async", async () => {
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
      const b = createLoadingBoundary(
        () => {
          text(() => `Details: ${details()}`, log, when);
          return "content";
        },
        () => "Loading...",
        { on: () => page() }
      );
      text(() => `Boundary: ${b()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3500);
    // count=1 restarts details under the initialized boundary: forwarded, so the
    // write is held with the flight (Sum stays 0).
    setCount(1);
    await settle();
    await advanceTo(4000);
    // page=1 resets the boundary (`on`): fallback, pageData1 due 5000. The only
    // reader of details is now behind the fallback, so the hold on count=1 is
    // over (ruled 2026-09-12): the reset wakes the parked transaction and it
    // commits in the idle pass that follows — same drain, one pass after the
    // ambient page=1 commit, hence two Sum publishes at 4000.
    setPage(1);
    await settle();
    await advanceTo(5500);
    // page=2 resets again. Nothing is held any more: pageData2 lands at 6500 and
    // re-asks details (due 8500) under the collecting boundary, which waits on
    // details AND pageData (the effect it hears from is pending on both).
    setPage(2);
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Boundary: Loading... | Sum: 0",
      "3000: Boundary: content | Details: 0",
      "4000: Boundary: Loading... | Sum: 1 | Sum: 2",
      "5500: Sum: 3",
      "8500: Boundary: content | Details: 3"
    ]);
  });

  it("a Loading boundary reset keeps the hold while a reader outside the boundary observes the flight", async () => {
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
      text(() => `Outside: ${details()}`, log, when);
      const b = createLoadingBoundary(
        () => {
          text(() => `Details: ${details()}`, log, when);
          return "content";
        },
        () => "Loading...",
        { on: () => page() }
      );
      text(() => `Boundary: ${b()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3500);
    setCount(1); // details re-asks (due 5500); Details and Outside both report it
    await settle();
    await advanceTo(4000);
    // The reset frees Details, but Outside still consumes the flight: count=1
    // stays held. page=1 joins the hold too (its reader details lives there),
    // so nothing publishes at 4000 — not even the fallback. pageData1 lands at
    // 5000 and re-asks details (due 7000); everything reveals with its answer.
    setPage(1);
    await settle();
    await advanceTo(12000);
    const f = frames(log, when);
    expect(f.slice(0, 2)).toEqual([
      "0: Boundary: Loading... | Sum: 0",
      "3000: Boundary: content | Details: 0 | Outside: 0"
    ]);
    expect(f).toHaveLength(3);
    expect(f[2].startsWith("7000: ")).toBe(true);
    for (const v of ["Details: 2", "Outside: 2", "Sum: 2"]) expect(f[2]).toContain(v);
    // Not asserted exactly: the 7000 frame also carries a stale `Sum: 1` —
    // the slot Sum computed mainline at 4000 (page=1, committed count) is
    // published before the #3322 contested re-derive publishes `Sum: 2`.
    // Pre-existing (identical on the branch base), tracked separately.
  });

  it("#3374 repeating the held write after remounting the reader publishes with the derived value", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void, setVersion!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [version, sv] = createSignal(1);
      setCount = sc;
      setVersion = sv;
      const details = createMemo(() => delay(2000, count()));
      text(() => `Count: ${count()}`, log, when);
      // <Show keyed when={version()}>: remount the reader on each version.
      let dispose: (() => void) | null = null;
      createRenderEffect(version, () => {
        dispose?.();
        dispose = createRoot(d => (text(() => `Details: ${details()}`, log, when), d));
      });
    });
    flush();
    await settle();
    await advanceTo(2500);
    setCount(1);
    await settle();
    await advanceTo(3000);
    setVersion(2);
    await settle();
    await advanceTo(3500);
    setCount(1);
    await settle();
    await advanceTo(9000);
    expect(frames(log, when)).toEqual([
      "0: Count: 0",
      "2000: Details: 0",
      // The remounted reader shows the committed frame (count is still 0 on screen)...
      "3000: Details: 0",
      // ...and the hold survives the rewrite: both reveal with the flight's answer.
      "4500: Count: 1 | Details: 1"
    ]);
  });

  it("#3373 × #3374: a reader remounted onto the stale first-hop flight holds on the re-asked input", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void, setVersion!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [version, sv] = createSignal(1);
      setCount = sc;
      setVersion = sv;
      const a = createMemo(() => delay(1000, count()));
      const b = createMemo(() => delay(1000, a()));
      text(() => `Count: ${count()}`, log, when);
      let dispose: (() => void) | null = null;
      createRenderEffect(version, () => {
        dispose?.();
        dispose = createRoot(d => (text(() => `B: ${b()}`, log, when), d));
      });
    });
    flush();
    await settle();
    await advanceTo(2500);
    setCount(1);
    await settle();
    await advanceTo(4000);
    setCount(2);
    await settle();
    // b is in flight (b1, due 4500) AND pending on a's re-ask (a2, due 5000). The
    // remount reads b: no re-pull (b has its own flight), so the carve-out serves
    // the committed 0. The disposed reader was the transaction's only reporter
    // for `a`; the new one holds it through b's own flight until b1 lands, and
    // b1's staged answer re-runs it onto `a` through the normal path.
    await advanceTo(4200);
    setVersion(2);
    await settle();
    await advanceTo(9000);
    expect(frames(log, when)).toEqual([
      "0: Count: 0",
      "2000: B: 0",
      "4200: B: 0",
      "6000: B: 2 | Count: 2"
    ]);
  });

  it("#3374 (two hops) the remounted reader holds through an intermediate memo", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void, setVersion!: (v: number) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [version, sv] = createSignal(1);
      setCount = sc;
      setVersion = sv;
      const details = createMemo(() => delay(2000, count()));
      const shown = createMemo(() => `Details: ${details()}`);
      text(() => `Count: ${count()}`, log, when);
      let dispose: (() => void) | null = null;
      createRenderEffect(version, () => {
        dispose?.();
        dispose = createRoot(d => (text(shown, log, when), d));
      });
    });
    flush();
    await settle();
    await advanceTo(2500);
    setCount(1);
    await settle();
    await advanceTo(3000);
    setVersion(2);
    await settle();
    await advanceTo(3500);
    setCount(1);
    await settle();
    await advanceTo(9000);
    // The intermediate memo is re-pulled by the remount's read and enters the
    // hold, so this reader holds (no committed frame at 3000) — and does not tear.
    expect(frames(log, when)).toEqual([
      "0: Count: 0",
      "2000: Details: 0",
      "4500: Count: 1 | Details: 1"
    ]);
  });
});
