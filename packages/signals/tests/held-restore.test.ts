import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
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
/** <Show when={cond()}>{children}</Show>: a memo on the condition and a render
 * effect that (re)creates the child root. */
function show(cond: () => boolean, children: () => void) {
  const c = createMemo(cond);
  let dispose: (() => void) | null = null;
  createRenderEffect(c, on => {
    dispose?.();
    dispose = null;
    if (on) dispose = createRoot(d => (children(), d));
  });
}

describe("a held write whose reader leaves before the hold commits", () => {
  it("#3372 the write is not lost when its only held-world reader is unmounted", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setMounted!: (v: boolean) => void, setShow!: (v: boolean) => void;
    createRoot(() => {
      const [mounted, sm] = createSignal(false);
      const [showSig, ss] = createSignal(false);
      setMounted = sm;
      setShow = ss;
      const details = createMemo(() => delay(1500, mounted()));
      text(() => `Show: ${showSig()}`, log, when);
      show(mounted, () =>
        text(() => `Details: ${showSig() ? String(details()) : "hidden"}`, log, when)
      );
    });
    flush();
    await settle();
    await advanceTo(2000);
    // mounted=true: details re-asks (due 3500) but the child shows "hidden" (show=false).
    setMounted(true);
    await settle();
    await advanceTo(2500);
    // show=true: the child now reads details (pending) — the write is held with it.
    setShow(true);
    await settle();
    await advanceTo(3000);
    // mounted=false: the child (the hold's only reader) is disposed before details lands.
    setMounted(false);
    await settle();
    await advanceTo(8000);
    expect(frames(log, when)).toEqual([
      "0: Show: false",
      "2000: Details: hidden",
      // The held show=true reveals once nothing observes the flight it waited on.
      "3000: Show: true"
    ]);
  });

  it("a wake with another live reader re-parks: the hold still waits for the flight", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void, setFlag!: (v: boolean) => void;
    createRoot(() => {
      const [a, sa] = createSignal(0);
      const [flag, sf] = createSignal(false);
      setA = sa;
      setFlag = sf;
      const d = createMemo(() => delay(1000, a()));
      text(() => `Flag: ${flag()}`, log, when);
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${d()}`, log, when);
      show(flag, () => text(() => `Child: ${d()}`, log, when));
    });
    flush();
    await advanceTo(2000);
    setFlag(true); // ambient: d is settled
    await settle();
    await advanceTo(3000);
    setA(1); // d re-asks (due 4000); Child and B both report it — a=1 is held
    await settle();
    await advanceTo(3500);
    setFlag(false); // Child leaves; B still reports
    await settle();
    await advanceTo(6000);
    expect(frames(log, when)).toEqual([
      "0: A: 0 | Flag: false",
      "1000: B: 0",
      "2000: Child: 0 | Flag: true",
      "3500: Flag: false",
      "4000: A: 1 | B: 1"
    ]);
  });

  it("a wake adopts no ambient write staged by the pass that disposed the reader", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void, setFlag!: (v: boolean) => void;
    createRoot(() => {
      const [a, sa] = createSignal(0);
      const [flag, sf] = createSignal(false);
      const [other, setOther] = createSignal(0);
      setA = sa;
      setFlag = sf;
      const d = createMemo(() => delay(1000, a()));
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${d()}`, log, when);
      text(() => `Other: ${other()}`, log, when);
      show(flag, () => text(() => `Child: ${d()}`, log, when));
      // Writes in the effect phase of the flush that unmounts Child: staged
      // ambient work when the woken transaction would be re-entered.
      let wasOn = false;
      createEffect(flag, f => {
        if (f) wasOn = true;
        else if (wasOn) setOther(1);
      });
    });
    flush();
    await advanceTo(2000);
    setFlag(true);
    await settle();
    await advanceTo(3000);
    setA(1);
    await settle();
    await advanceTo(3500);
    setFlag(false);
    await settle();
    await advanceTo(6000);
    expect(frames(log, when)).toEqual([
      "0: A: 0 | Other: 0",
      "1000: B: 0",
      "2000: Child: 0",
      // other=1 commits ambiently — it did not join the hold on a=1.
      "3500: Other: 1",
      "4000: A: 1 | B: 1"
    ]);
  });
});

describe("latest() after an equality-cancelled staged write", () => {
  it("#3377 the pair keeps updating after an intermediate write restores the initial value", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let update!: () => Promise<void>;
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const details = createMemo(() => delay(600, latest(count)));
      update = action(function* () {
        setCount(2);
        yield delay(400);
        setCount(0);
        yield delay(800);
        setCount(2);
      });
      text(() => `Count: ${count()}`, log, when);
      text(() => `Pair: ${details()} / ${latest(count)}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(1000);
    update();
    await settle();
    await advanceTo(6000);
    expect(log.filter(l => l.startsWith("Pair")).at(-1)).toBe("Pair: 2 / 2");
    expect(log.filter(l => l.startsWith("Count")).at(-1)).toBe("Count: 2");
  });
});
