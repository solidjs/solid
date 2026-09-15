import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  onCleanup
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

// A held lane is a transaction seen from the outside (A15 lanes corollary,
// #3460 / #3463): a render effect OFF the lane sees the committed value — the
// lane defers its own readers' runs, so that is what is on screen — publishes
// now (a sync write is never held by a lane), and re-derives at the release.
// Inside, a reader ON the lane computes the lane's reveal as before.
describe("a held lane from the outside", () => {
  // `Value` and `Details` are dirtied by the action's write and ride the
  // lane; `Details`' flight holds it. `Late` mounts a flush later, mainline,
  // and used to read the shadow's speculative `1` beside the deferred
  // `Value: 0`. Now it shows `0`, and the release re-runs it.
  it("#3460 a latest() reader mounted mid-hold shows the visible value and reveals with the lane", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setShow!: (v: boolean) => void;
    let start!: () => unknown;
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const [show, ss] = createSignal(false);
      setShow = ss;
      const value = () => latest(count);
      const details = createMemo(() => delay(2000, value()));
      start = action(function* () {
        setCount(1);
        yield delay(3000);
        setCount(0);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
      text(() => `Late: ${show() ? value() : "hidden"}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    start();
    await settle();
    await advanceTo(3500);
    setShow(true);
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Late: hidden | Value: 0",
      "2000: Details: 0",
      "3500: Late: 0",
      "5000: Details: 1 | Late: 1 | Value: 1",
      "8000: Details: 0 | Late: 0 | Value: 0"
    ]);
  });

  it("#3460 a createOptimistic reader mounted mid-hold behaves the same (latest() is not special)", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setShow!: (v: boolean) => void;
    let start!: () => unknown;
    createRoot(() => {
      const [count, setCount] = createOptimistic(0);
      const [show, ss] = createSignal(false);
      setShow = ss;
      const details = createMemo(() => delay(2000, count()));
      start = action(function* () {
        setCount(1);
        yield delay(3000);
      });
      text(() => `Value: ${count()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
      text(() => `Late: ${show() ? count() : "hidden"}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    start();
    await settle();
    await advanceTo(3500);
    setShow(true);
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Late: hidden | Value: 0",
      "2000: Details: 0",
      "3500: Late: 0",
      "5000: Details: 1 | Late: 1 | Value: 1",
      "8000: Details: 0 | Late: 0 | Value: 0"
    ]);
  });

  // Maintainer: "we wouldn't hold a sync write on a transition. Lanes are the
  // same." The sibling write re-runs the effect, which publishes at once with
  // the committed view of the held value, and again at the release.
  it("#3460 a sync write re-running a reader mid-hold reveals at once with the committed view", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setOther!: (v: string) => void;
    let start!: () => unknown;
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const [other, so] = createSignal("x");
      setOther = so;
      const value = () => latest(count);
      const details = createMemo(() => delay(2000, value()));
      start = action(function* () {
        setCount(1);
        yield delay(3000);
        setCount(0);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
      text(() => `Both: ${value()} ${other()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    start();
    await settle();
    await advanceTo(3500);
    setOther("y");
    await settle();
    await advanceTo(12000);
    const fs = frames(log, when);
    expect(fs.slice(0, 4)).toEqual([
      "0: Both: 0 x | Value: 0",
      "2000: Details: 0",
      "3500: Both: 0 y",
      "5000: Both: 1 y | Details: 1 | Value: 1"
    ]);
    // The revert at 8000 runs `Both` twice on `next` today (both `0 y`);
    // pinned by value, not by count.
    expect(fs.length).toBe(5);
    expect([...new Set(fs[4].slice(6).split(" | "))]).toEqual([
      "Both: 0 y",
      "Details: 0",
      "Value: 0"
    ]);
  });

  // #3463: the action stages `show=false`; `Details` is a zombie — its removal
  // cannot commit while the action runs, so it stays on screen. It was treated
  // as dead for the hold and the lane revealed `Value: 1` beside its `Details:
  // 0`. A zombie blocks unless the judgment IS the commit that disposes it.
  it("#3463 a reader whose removal is staged keeps holding the lane while it is visible", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setShow!: (v: boolean) => void;
    let start!: () => unknown;
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const [show, ss] = createSignal(true);
      setShow = ss;
      const value = () => latest(count);
      const details = createMemo(() => delay(1000, value()));
      start = action(function* () {
        setCount(1);
        yield delay(2000);
        setCount(0);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Show: ${show()}`, log, when);
      createRenderEffect(
        () => {
          if (show()) {
            text(() => `Details: ${details()}`, log, when);
            onCleanup(() => {
              log.push("Details gone");
              when.push(now);
            });
          }
        },
        () => {}
      );
    });
    flush();
    await settle();
    await advanceTo(3000);
    start();
    setShow(false);
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Show: true | Value: 0",
      "1000: Details: 0",
      "4000: Details: 1 | Value: 1",
      "6000: Details gone | Show: false | Value: 0"
    ]);
  });

  // The verdict of the transaction that stages the removal is the commit that
  // disposes the zombie: with nothing else holding, the removal commits at
  // once and the zombie's say is moot (#3426 spirit: an unmounting reader
  // releases). Unchanged behavior, pinned beside its counterpart.
  it("#3463 a plain removal with nothing else holding still releases at once", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => void;
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const [show, setShow] = createSignal(true);
      const value = () => latest(count);
      const details = createMemo(() => delay(1000, value()));
      run = () => {
        setCount(1);
        setShow(false);
      };
      text(() => `Value: ${value()}`, log, when);
      text(() => `Show: ${show()}`, log, when);
      createRenderEffect(
        () => {
          if (show()) {
            text(() => `Details: ${details()}`, log, when);
            onCleanup(() => {
              log.push("Details gone");
              when.push(now);
            });
          }
        },
        () => {}
      );
    });
    flush();
    await settle();
    await advanceTo(3000);
    run();
    await settle();
    await advanceTo(12000);
    expect(frames(log, when)).toEqual([
      "0: Show: true | Value: 0",
      "1000: Details: 0",
      "3000: Details gone | Show: false | Value: 1"
    ]);
  });
});
