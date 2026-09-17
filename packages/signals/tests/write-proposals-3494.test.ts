import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
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
/** Explicit flights (gabbev's standalone shape): each pass parks a resolver. */
function requestQueue() {
  const requests: (() => void)[] = [];
  return {
    ask<T>(value: T) {
      return new Promise<T>(r => requests.push(() => r(value)));
    },
    async land(n = Infinity) {
      while (n-- > 0 && requests.length) requests.shift()!();
      await settle();
    },
    /** Resolve without yielding — the landing job runs after the caller's tick. */
    resolveNext() {
      requests.shift()!();
    },
    /** The newest flight lands first; older ones stay up. */
    resolveLast() {
      requests.pop()!();
    },
    get pending() {
      return requests.length;
    }
  };
}

// A34 (#3494, gabbev, after #3473). A write PROPOSES a value. Ruled 2026-09-16:
//  - a proposal on a node that already carries an uncommitted one — held by a
//    transaction — entangles the proposer's tick with that hold, same value or
//    not ("both are suggesting a value; if one finished before the other that
//    would be odd");
//  - a tick whose proposal nets to the COMMITTED value made none: the node is
//    not staged, not stamped, and pends nothing.
describe("A34 — a write is a proposal (#3494)", () => {
  it("contract: repeating a held value entangles the tick, as a differing write does", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(0);
      const [b, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      const obs = createMemo(() => delay(1000, b()));
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${b()}`, log, when);
      text(() => `Obs: ${obs()}`, log, when);
    });
    flush();
    await advanceTo(1000);
    setB(1);
    await settle();
    await advanceTo(1500);
    // The repeat is a second proposal for `b`'s held `1`: A rides with it.
    setA(1);
    setB(1);
    await settle();
    await advanceTo(3000);
    expect(frames(log, when)).toEqual([
      "0: A: 0 | B: 0",
      "1000: Obs: 0",
      "2000: A: 1 | B: 1 | Obs: 1"
    ]);
  });

  it("a differing mainline write to a held node holds its tick-mates with it", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(0);
      const [b, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      const obs = createMemo(() => delay(1000, b()));
      text(() => `A: ${a()}`, log, when);
      text(() => `B: ${b()}`, log, when);
      text(() => `Obs: ${obs()}`, log, when);
    });
    flush();
    await advanceTo(1000);
    setB(1);
    await settle();
    await advanceTo(1500);
    setA(1);
    setB(2);
    await settle();
    await advanceTo(4000);
    // `b=2` re-asks obs (lands 2500); the whole tick reveals with it.
    expect(frames(log, when)).toEqual([
      "0: A: 0 | B: 0",
      "1000: Obs: 0",
      "2500: A: 1 | B: 2 | Obs: 2"
    ]);
  });

  it("a tick that nets to the committed value proposes nothing: no stamp, no verdict", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    let show!: () => boolean;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [sh, ss] = createSignal(true);
      setCount = sc;
      setShow = ss;
      show = sh;
      const data = createMemo(() => delay(2000, count()));
      text(() => `Data: ${data()}`, log, when);
      text(() => `Show: ${show()}`, log, when);
    });
    flush();
    await advanceTo(2000);
    setShow(false);
    setShow(true);
    setCount(1);
    await settle();
    // `count=1` is held on data's flight; `show` was never written as far as
    // the graph is concerned.
    expect(isPending(show)).toBe(false);
    expect(show()).toBe(true);
    await advanceTo(2500);
    setShow(false);
    await settle();
    expect(show()).toBe(false);
    await advanceTo(6000);
    expect(frames(log, when)).toEqual([
      "0: Show: true",
      "2000: Data: 0",
      "2500: Show: false",
      "4000: Data: 1"
    ]);
  });

  // #3494 "torn effect input" (original comment A on #3473): a signal and its
  // synchronous identity memo disagree inside one effect run, `[1, 0, 1]`.
  it("an effect never receives a signal beside a stale identity memo of it", async () => {
    reset();
    const q = requestQueue();
    const log: string[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [show, ss] = createSignal(false);
      setCount = sc;
      setShow = ss;
      const details = createMemo(() => q.ask(count()));
      const copy = createMemo(count);
      createRenderEffect(
        () => (show() ? `${count()} ${copy()} ${details()}` : null),
        v => {
          if (v) log.push(v);
        }
      );
      createRenderEffect(details, () => {});
    });
    flush();
    await q.land();
    setCount(1);
    setCount(0);
    await settle();
    setShow(true);
    setCount(1);
    await settle();
    await q.land();
    expect(log).toEqual(["1 1 1"]);
  });

  // #3494 "lost visibility update": coalesced show writes beside a held count;
  // the later hide never publishes although every request has resolved.
  it("a hide after a coalesced toggle publishes, and at once", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [show, ss] = createSignal(true);
      setCount = sc;
      setShow = ss;
      const data = createMemo(() => delay(2000, count()));
      const panel = () => (show() ? data() : "hidden");
      text(() => `Data: ${panel()}`, log, when);
    });
    flush();
    await advanceTo(2000);
    setShow(false);
    setShow(true);
    setCount(1);
    await settle();
    await advanceTo(2500);
    setShow(false);
    await settle();
    await advanceTo(6000);
    // `show` proposed nothing at 2000, so the hide is a plain mainline write:
    // the effect's pass is the writer's (A15 shared-hole), it stops reading
    // `data`, and the hold on `count` — its last reader gone — releases (O3).
    expect(frames(log, when)).toEqual(["2000: Data: 0", "2500: Data: hidden"]);
  });

  // #3494 "stale visible derivation": the flight's last reader leaves and a new
  // reader reveals it in the same flush; the release won and `Count: 1`
  // published beside a visible `Copy: 0` still waiting on `count=1`'s flight.
  it("a reveal in the flush that retires the last reader holds the transaction", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    let setDirect!: (v: boolean) => void;
    let copy!: () => number;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [show, ss] = createSignal(true);
      const [direct, sd] = createSignal(true);
      setCount = sc;
      setShow = ss;
      setDirect = sd;
      const details = createMemo(() => delay(1500, count()));
      copy = createMemo(details);
      text(() => `Count: ${count()}`, log, when);
      text(() => `Direct: ${direct() ? details() : "gone"}`, log, when);
      text(() => `Copy: ${show() ? copy() : "hidden"}`, log, when);
    });
    flush();
    await advanceTo(2000);
    setShow(false);
    await settle();
    await advanceTo(2500);
    setCount(1);
    latest(copy);
    await settle();
    await advanceTo(3000);
    setShow(true);
    setDirect(false);
    await settle();
    await advanceTo(6000);
    expect(frames(log, when)).toEqual([
      "0: Count: 0",
      "1500: Copy: 0 | Direct: 0",
      "2000: Copy: hidden",
      "3000: Copy: 0 | Direct: gone",
      "4000: Copy: 1 | Count: 1"
    ]);
  });

  // #3494 "delayed release": the only reader of the flight is removed and
  // `latest()` is read untracked from mainline; the held write waited on the
  // orphaned request anyway.
  it("removing the last reader releases the write; a mainline latest() holds nothing", async () => {
    reset();
    const q = requestQueue();
    const seen: number[] = [];
    let count!: () => number;
    let setCount!: (v: number) => void;
    let details!: () => number;
    let removeReader!: () => void;
    createRoot(() => {
      const [c, sc] = createSignal(0);
      count = c;
      setCount = sc;
      details = createMemo(() => q.ask(count()));
      createRenderEffect(count, v => {
        seen.push(v);
      });
      removeReader = createRoot(remove => {
        createRenderEffect(details, () => {});
        return remove;
      });
    });
    flush();
    await q.land();
    setCount(1);
    await settle();
    // `1`'s answer lands in the tick that rewrites the held node (the landing
    // job runs after the two writes, before the flush).
    q.resolveNext();
    setCount(0);
    setCount(1);
    await settle();
    removeReader();
    latest(details);
    await settle();
    expect(count()).toBe(1);
    expect(seen).toEqual([0, 1]);
    await q.land();
    expect(count()).toBe(1);
  });

  // Differential fuzzing of the ruling (gabbev's #3446 fuzzer, latest-2 #1470,
  // S3). The action proposes 1, then 0 — the committed value — and its
  // transaction folds into the one a mainline `show` opened. The no-proposal
  // drop took the folded node for a fresh tick's, unstaged it and left its
  // dead stamp; the authoritative 1 then queued under the merged transaction
  // as another's and the commit skipped it — readers revealed 1 beside a
  // source anchor stuck at 0. A node already a transaction's is held, not
  // proposal-free.
  it("a held proposal rewritten to the committed value stays the transaction's; its truth commits", async () => {
    reset();
    const q = requestQueue();
    const log: string[] = [];
    const when: number[] = [];
    const gates: (() => void)[] = [];
    let setShow!: (v: boolean) => void;
    let run!: () => unknown;
    createRoot(() => {
      const [source, setSource] = createSignal(0);
      const [show, ss] = createSignal(false);
      setShow = ss;
      const value = () => latest(source);
      const node = createMemo(() => q.ask(value()));
      run = action(function* () {
        setSource(1);
        yield new Promise<void>(r => gates.push(r));
        setSource(0);
        yield new Promise<void>(r => gates.push(r));
        setSource(1);
      });
      text(() => `Source: ${source()}`, log, when);
      text(() => `Always: ${node()}`, log, when);
      text(() => `Gated: ${show() ? node() : "hidden"}`, log, when);
    });
    flush();
    await q.land();
    run();
    await settle();
    gates.shift()!();
    await settle();
    // The gated reader mounts on the flight for 0, which lands first.
    setShow(true);
    q.resolveLast();
    await settle();
    gates.shift()!();
    await settle();
    await q.land();
    const shown = (prefix: string) => log.filter(l => l.startsWith(prefix));
    expect(shown("Source").at(-1)).toBe("Source: 1");
    expect(shown("Always").at(-1)).toBe("Always: 1");
    expect(shown("Gated").at(-1)).toBe("Gated: 1");
  });

  // Fuzzer latest-1 #2141 (O2). `show` and the action's proposal share a tick,
  // so the hide is a second proposal on a held node and rides with the action
  // (A34). Its pass under the parked transaction stopped reading the memo but
  // changed nothing, so its tail stayed linked (A30); the action's truth
  // re-asked the memo, and the pending mark rode that kept link back to the
  // reader — registered as a reporter of a fetch it no longer asked for, it
  // held the truth until the orphaned flight landed. A pending mark rides
  // only the links a pass made.
  it("a reader that stopped reading a memo is not held by the memo's next flight", async () => {
    reset();
    const q = requestQueue();
    const log: string[] = [];
    const when: number[] = [];
    const gates: (() => void)[] = [];
    let setShow!: (v: boolean) => void;
    let run!: () => unknown;
    createRoot(() => {
      const [source, setSource] = createSignal(0);
      const [show, ss] = createSignal(false);
      setShow = ss;
      const value = () => latest(source);
      const node = createMemo(() => q.ask(value()));
      run = action(function* () {
        setSource(1);
        yield new Promise<void>(r => gates.push(r));
        setSource(0);
      });
      text(() => `Latest: ${value()}`, log, when);
      text(() => `Reader: ${show() ? node() : "hidden"}`, log, when);
    });
    flush();
    await q.land();
    run();
    setShow(true);
    await settle();
    setShow(false);
    await settle();
    gates.shift()!();
    await settle();
    // The truth is on screen before the memo's orphaned flights land.
    const shown = () => log.filter(l => l.startsWith("Latest"));
    expect(q.pending).toBe(2);
    expect(shown().at(-1)).toBe("Latest: 0");
    await q.land();
    expect(shown()).toEqual(["Latest: 0", "Latest: 1", "Latest: 0"]);
  });
});

// #3519 review. Three holes in the first cut, each pinned before its fix.
describe("A34 — review (#3519)", () => {
  // The kept tail IS the committed frame's dependency list (A30). A flight on
  // one of those deps makes the committed frame non-final — the frame that a
  // mainline (or any OTHER transaction's) commit would publish beside its
  // new inputs. The pending mark may be skipped only when the mark's
  // transaction is the one holding the subscriber's replacement frame: that
  // frame does not read the dep, and it is what that commit publishes.
  it("a kept-tail dep going pending under another transaction holds the committed frame", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setQuery!: (v: number) => void;
    let switchMode!: () => unknown;
    let selected!: () => number;
    createRoot(() => {
      const [query, sq] = createSignal(0);
      const [mode, setMode] = createSignal(false);
      setQuery = sq;
      const remote = createMemo(() => delay(1000, query()));
      selected = createMemo(() => (mode() ? 0 : remote()));
      switchMode = action(function* () {
        setMode(true);
        yield delay(10_000);
      });
      text(() => `${query()} ${selected()}`, log, when);
    });
    flush();
    await advanceTo(1000);
    // A held pass switches `selected` to the constant 0 — unchanged, so its
    // tail (remote) stays linked — and parks with the action.
    switchMode();
    await settle();
    await advanceTo(1500);
    // Mainline: a new flight on `remote`. The committed `selected` derives
    // from remote=0; publishing `1 0` would be a torn frame.
    setQuery(1);
    await settle();
    await advanceTo(2000);
    expect(frames(log, when)).toEqual(["1000: 0 0"]);
    // The mark rode the kept link, `selected` re-derived, read the held
    // `mode` and entered the action's transaction (A29): the tick is held.
    // `selected` itself is not pending (A19): its observable value is 0 and
    // stays 0 — the held frame is the constant, and the committed one only
    // ever re-derives under a commit that publishes the held frame instead.
    expect(isPending(selected)).toBe(false);
    await advanceTo(3000);
    // The flight landed; the tick is still held (the action runs to 11000).
    expect(frames(log, when)).toEqual(["1000: 0 0"]);
    await advanceTo(12_000);
    expect(frames(log, when)).toEqual(["1000: 0 0", "11000: 1 0"]);
  });

  // A same-value write to a held node records the join, then leaves through
  // setSignal's equality gate. Without a schedule the join outlived its tick
  // and the next unrelated flush drained it — adopting that tick's work into
  // a hold it never touched.
  it("a lone same-value write to a held node does not capture the next unrelated tick", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setB!: (v: number) => void;
    let setC!: (v: number) => void;
    createRoot(() => {
      const [b, sb] = createSignal(0);
      const [c, sc] = createSignal(0);
      setB = sb;
      setC = sc;
      const obs = createMemo(() => delay(1000, b()));
      text(() => `Obs: ${obs()}`, log, when);
      text(() => `C: ${c()}`, log, when);
    });
    flush();
    await advanceTo(1000);
    setB(1);
    await settle();
    await advanceTo(1500);
    setB(1); // the repeat: a proposal, and the tick's only write
    await settle();
    await advanceTo(1600);
    setC(1); // an unrelated tick
    await settle();
    expect(frames(log, when)).toEqual(["0: C: 0", "1000: Obs: 0", "1600: C: 1"]);
    await advanceTo(3000);
    expect(frames(log, when)).toEqual(["0: C: 0", "1000: Obs: 0", "1600: C: 1", "2000: Obs: 1"]);
  });

  // A34 (2) for the memo form: `createSignal(fn)`'s setter stages through
  // setSignal too, and a manual write back to the committed value is as much
  // "no proposal" as a signal's.
  it("a writable memo written back to its committed value proposes nothing", async () => {
    reset();
    const log: string[] = [];
    const when: number[] = [];
    let setCount!: (v: number) => void;
    let setShow!: (v: boolean) => void;
    let show!: () => boolean;
    createRoot(() => {
      const [count, sc] = createSignal(0);
      const [base] = createSignal(true);
      const [sh, ss] = createSignal(() => base());
      setCount = sc;
      setShow = ss;
      show = sh;
      const data = createMemo(() => delay(2000, count()));
      text(() => `Data: ${data()}`, log, when);
      text(() => `Show: ${show()}`, log, when);
    });
    flush();
    await advanceTo(2000);
    setShow(false);
    setShow(true);
    setCount(1);
    await settle();
    expect(isPending(show)).toBe(false);
    expect(show()).toBe(true);
    await advanceTo(2500);
    setShow(false);
    await settle();
    expect(show()).toBe(false);
    await advanceTo(6000);
    // The hide is mainline (the point of the drop) — and the `Show` effect had
    // computed under `count`'s born-held transaction at 2000 (it sits above
    // the memo, so it ran after `data` pended), so it is a contested effect
    // (#3322): the reveal at 4000 re-derives it against the committed world.
    // Same value, one redundant run; the signal form above computes below the
    // transaction's birth and is never contested. Not this rule's business.
    expect(frames(log, when)).toEqual([
      "0: Show: true",
      "2000: Data: 0",
      "2500: Show: false",
      "4000: Data: 1 | Show: false"
    ]);
  });
});
