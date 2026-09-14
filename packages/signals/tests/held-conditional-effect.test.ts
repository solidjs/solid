import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner
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
  let node: any;
  createRenderEffect(
    () => {
      node ??= getOwner();
      return fn();
    },
    v => {
      if (v !== last) {
        last = v;
        log.push(v);
        when.push(now);
      }
    }
  );
  return () => {
    const names: string[] = [];
    for (let d = node._deps; d !== null; d = d._nextDep)
      names.push(d._dep._name + (d === node._depsTail ? "]" : ""));
    return names.join(",");
  };
}

describe("conditional render effect across a held branch change (#3438)", () => {
  it("A30 / #3438 an effect whose held pass trimmed an input still agrees with its committed inputs", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    let deps!: () => string;
    createRoot(() => {
      const [count, sC] = createSignal(0, { name: "count" });
      const [show, sS] = createSignal(true, { name: "show" });
      setCount = sC;
      setShow = sS;
      const delayedShow = createMemo(() => delay(1000, show()), undefined, { name: "delayedShow" });
      // Shape the compiler emits for `{show() ? count() : "hidden"}`.
      const c = createMemo(() => !!show(), undefined, { name: "c" });
      text(() => `Count: ${count()}`, log, when);
      text(() => `Show: ${show()}`, log, when);
      deps = text(() => `Panel: ${c() ? count() : "hidden"}`, log, when);
      text(() => `Delayed: ${delayedShow()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    expect(deps()).toBe("computed,count]");
    setShow(false);
    await settle();
    // The held pass validated only `c`; count stays linked past the tail.
    expect(deps()).toBe("computed],count");
    await advanceTo(2500);
    setCount(1);
    await settle();
    expect(deps()).toBe("computed,count]");
    await advanceTo(5000);
    // The `show` flip (2000) is held by delayedShow. Panel's held pass stopped
    // reading count; before, its trim dropped that edge at the pass while the
    // run was stashed, so the count write (2500) revealed `Count: 1` beside
    // `Panel: 0` (the frame still showing the old count). Now the edge lives
    // until the run applies: the write reaches Panel, which — a render effect,
    // a mainline reader of the foreign hold — re-derives against the committed
    // `show` and publishes `Panel: 1` with `Count: 1`, then lands `hidden` with
    // the hold's reveal.
    expect(frames(log, when)).toEqual([
      "0: Count: 0 | Panel: 0 | Show: true",
      "1000: Delayed: true",
      "2500: Count: 1 | Panel: 1",
      "3000: Delayed: false | Panel: hidden | Show: false"
    ]);
  });
});
