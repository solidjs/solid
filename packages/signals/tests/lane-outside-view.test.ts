import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createLoadingBoundary,
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

  // Lanes stage (#3479 review, fuzzer latest-1 #1955): the committed view an
  // outsider sees must be a WHOLE frame. A memo derived from the held value
  // used to publish its speculative result straight into `_value` (the lane's
  // direct commit), so a reader mounted mid-hold saw the source's committed
  // `0` beside the derivation's speculative `1` — a torn tuple. A lane pass
  // now publishes a derived override: `_value` stays committed for the
  // outsider, the override is the lane's view, and the release re-runs the
  // outsider with the revealed frame.
  it("#3479 an outsider mounted mid-hold sees the held value and its derivation as one committed frame", async () => {
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
      const derived = createMemo(() => value());
      const details = createMemo(() => delay(2000, value()));
      start = action(function* () {
        setCount(1);
        yield delay(3000);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Derived: ${derived()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
      text(() => `Late: ${show() ? `${value()} ${derived()}` : "hidden"}`, log, when);
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
    // `Late: 0 0` at 3500 (was `0 1`); `1 1` with the lane's reveal at 5000.
    // No frame after the reveal: the revert PROMOTES the derived overrides
    // (the truth confirmed the guess) instead of re-deriving `details` and
    // re-asking its flight — which held the transaction to 8000 for a frame
    // identical to the one on screen.
    expect(frames(log, when)).toEqual([
      "0: Derived: 0 | Late: hidden | Value: 0",
      "2000: Details: 0",
      "3500: Late: 0 0",
      "5000: Derived: 1 | Details: 1 | Late: 1 1 | Value: 1"
    ]);
  });

  // #3479 review (gabbev, differential fuzzing): the optimistic `1` never
  // finishes preparing — `details` is still in flight when the body ends and
  // the truth (`0`) supersedes. The landing of `fast` re-enters the lane's
  // transaction with no ambient lane; read as an outsider, that pass published
  // the committed view and queued a replay that later revealed `1` beside the
  // stale `0` derivation (`1:0`). A pass under the lane's own transaction is
  // the lane's work (provenance, not membership).
  it("#3479 an optimistic value that never finished preparing does not show beside its old derivation", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let save!: () => unknown;
    createRoot(() => {
      const [source, setSource] = createSignal(0);
      const [value, setValue] = createOptimistic(source);
      const fast = createMemo(async () => value());
      const details = createMemo(() => delay(1500, fast()));
      save = action(function* () {
        setValue(1);
        yield delay(500);
        setSource(0);
      });
      text(() => `${value()}:${details()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(3000);
    save();
    await settle();
    await advanceTo(9000);
    // Never `1:0`, and never `1:1` (the guess was wrong).
    expect(frames(log, when).map(f => f.split(": ")[1])).toEqual(["0:0", "0:0"]);
  });

  // #3479 review (fuzzer latest-1 #2481): a loading boundary mounted mid-hold
  // holds a memo born under the lane — its first pass threw, `_value` never
  // committed. Its landing dirtied the memo twice: the lane pass published
  // the derived override, then the boundary reset re-ran it PLAIN. Still a
  // lane member, that pass re-derived the lane's view (a fresh tuple) and
  // A18's sync twin took it for a differing truth: superseded, lane demoted.
  // The lane's next pass dropped the staged "truth" and left the flag —
  // readers were served the never-committed `undefined`. A pass over a live
  // lane member carrying a derived override is the lane's pass.
  it("#3479 a boundary mounted mid-hold over a lane-born memo reveals a whole tuple, never undefined", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setMounted!: (v: boolean) => void;
    let start!: () => unknown;
    createRoot(() => {
      const [source, setSource] = createSignal(0);
      const [mounted, sm] = createSignal(false);
      setMounted = sm;
      const value = () => latest(source);
      const node = createMemo(() => delay(1000, value()));
      start = action(function* () {
        setSource(1);
        yield delay(1500);
        setSource(0);
        yield delay(1500);
        setSource(1);
      });
      text(() => `Node: ${node()}`, log, when);
      createRenderEffect(
        () => {
          if (!mounted()) return;
          createRoot(dispose => {
            onCleanup(dispose);
            const view = createLoadingBoundary(
              () => `${value()} ${node()}`,
              () => "loading"
            );
            text(() => `Late: ${view()}`, log, when);
          });
        },
        () => {}
      );
    });
    flush();
    await settle();
    await advanceTo(1000);
    start();
    await settle();
    await advanceTo(3000);
    setMounted(true);
    await settle();
    await advanceTo(9000);
    // `Late` never publishes `undefined`; it reveals the whole tuple with the
    // lane. `Node` is the lane's own reader and shows each landing.
    expect(frames(log, when)).toEqual([
      "1000: Node: 0",
      "2000: Node: 1",
      "3000: Late: loading",
      "3500: Node: 0",
      "5000: Late: 1 1 | Node: 1"
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
    // At 5000 the action's body is done and the only pending reader is the
    // zombie itself — its refetch of `count=0` is moot for the verdict of the
    // transaction that disposes it, so the removal commits at once. (This
    // frame read 6000 while a zombie's rerun dropped REACTIVE_ZOMBIE, #3543:
    // the 4000 rerun made `Details` a live reader that held the commit for a
    // fetch nothing would display.)
    expect(frames(log, when)).toEqual([
      "0: Show: true | Value: 0",
      "1000: Details: 0",
      "4000: Details: 1 | Value: 1",
      "5000: Details gone | Show: false | Value: 0"
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
