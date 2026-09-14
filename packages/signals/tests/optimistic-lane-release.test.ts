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

describe("an optimistic lane releases when nothing authoritative is left to wait on", () => {
  it("#3426 the last async reader unmounting mid-action releases the optimistic frame", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => Promise<void>;
    let setShow!: (v: boolean) => void;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const [show, sS] = createSignal(true);
      setShow = sS;
      const details = createMemo(() => delay(1500, value()));
      run = action(function* () {
        setValue(1);
        yield delay(3000);
      });
      text(() => `Value: ${value()}`, log, when);
      createRenderEffect(
        () => show(),
        s => {
          if (!s) return;
          const dispose = createRoot(d => {
            text(() => `Details: ${details()}`, log, when);
            return d;
          });
          return () => {
            dispose();
            log.push("Details: <unmounted>");
            when.push(now);
          };
        }
      );
    });
    flush();
    await settle();
    await advanceTo(2000);
    run();
    await settle();
    await advanceTo(2500);
    setShow(false);
    await settle();
    await advanceTo(8000);
    // The lane held Value: 1 on the Details reader observing details pending.
    // A live action parks its transaction without a settle verdict, so that
    // reader's registration was never pruned when it died (2500): the lane
    // went on waiting for the flight nobody observed (3500). Now the hold
    // check prunes dead reporters itself: the frame reveals at the unmount
    // and reverts when the action ends, like a plain write would.
    expect(frames(log, when)).toEqual([
      "0: Value: 0",
      "1500: Details: 0",
      "2500: Details: <unmounted> | Value: 1",
      "5000: Value: 0"
    ]);
  });

  it("#3427 the action body ending starts the correction; the obsolete optimistic flight is not waited on", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => Promise<void>;
    let setOther!: (v: number) => void;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const [other, sO] = createSignal(0);
      setOther = sO;
      const details = createMemo(() => delay(1000, value()));
      run = action(function* () {
        setValue(1);
        yield delay(500);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
      text(() => `Pending: ${isPending(details)}`, log, when);
      text(() => `Other: ${other()}`, log, when);
      onSettled(() => {
        log.push("settled");
        when.push(now);
      });
    });
    flush();
    await settle();
    await advanceTo(2000);
    run().then(() => {
      log.push("action resolved");
      when.push(now);
    });
    await settle();
    await advanceTo(2600);
    setOther(1);
    await settle();
    await advanceTo(8000);
    // details(1) is a question about the guess; the body ending (2500) with
    // no authoritative flight up makes the guess obsolete. The truth (0)
    // supersedes the override then and details re-asks with it as the
    // transaction's held work — landing 3500, nothing visible changes. Before,
    // the settle waited for details(1) (3000: Value 1 | Details 1 flashed),
    // then reverted and re-asked (4000: 0 | 0) — a waterfall with a flash.
    // The transaction is over at 3500 (Pending false); unrelated writes
    // (Other, 2600) were never entangled.
    expect(frames(log, when)).toEqual([
      "0: Other: 0 | Value: 0",
      "1000: Details: 0 | Pending: false | settled",
      "2000: Pending: true",
      "2500: action resolved",
      "2600: Other: 1",
      "3500: Pending: false"
    ]);
  });

  it("#3427 a lane-derived memo re-asks with the truth and its held plain inputs, in one frame", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => Promise<void>;
    createRoot(() => {
      const [value, setValue] = createOptimistic(0);
      const [page, setPage] = createSignal(1);
      const details = createMemo(() => delay(1000, `${value()}/${page()}`));
      run = action(function* () {
        setValue(1);
        setPage(2);
        yield delay(500);
      });
      text(() => `Value: ${value()}`, log, when);
      text(() => `Page: ${page()}`, log, when);
      text(() => `Details: ${details()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    run();
    await settle();
    await advanceTo(8000);
    // The optimistic pass asked details(1, page=1) — the held page write is
    // gated for a lane recompute — and before the fix that answer flashed
    // beside Page: 2 | Value: 1 (3000) ahead of the correction (4000). The
    // correction now re-asks details(0, 2) at the body's end and the page
    // lands with its answer.
    expect(frames(log, when)).toEqual([
      "0: Page: 1 | Value: 0",
      "1000: Details: 0/1",
      "3500: Details: 0/2 | Page: 2"
    ]);
  });

  it("a co-written flag stays through a held plain load the action asked for (authoritative work)", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let run!: () => Promise<void>;
    createRoot(() => {
      const [saving, setSaving] = createOptimistic(false);
      const [page, setPage] = createSignal(1);
      const posts = createMemo(() => delay(1000, `p${page()}`));
      run = action(function* () {
        setSaving(true);
        setPage(2);
        yield;
      });
      text(() => `Saving: ${saving()}`, log, when);
      text(() => `Posts: ${posts()}`, log, when);
    });
    flush();
    await settle();
    await advanceTo(2000);
    run();
    await settle();
    await advanceTo(8000);
    // posts' flight does not derive from the override: it is the page load
    // the action asked for, and the optimistic world stands until it lands.
    // The body ending at once (yield) does not revert the flag early.
    expect(frames(log, when)).toEqual([
      "0: Saving: false",
      "1000: Posts: p1",
      "2000: Saving: true",
      "3000: Posts: p2 | Saving: false"
    ]);
  });
});
