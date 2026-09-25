import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, costs, formatRerun, subscriptions, why } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  createStore,
  flush,
  refresh,
  OBSERVE
} from "../src/index.js";
import type { AttributionOptions, RerunEvent } from "../src/core/attribution.js";
import type { RecordListener, RecordType } from "../src/core/dev.js";
import type { Computed } from "../src/core/types.js";

// The engine's records arrive on the channel, whose subscriptions are the
// consumer's — not dropped by `disable()` — so each test's are released here.
const offs: (() => void)[] = [];
function on<K extends RecordType>(type: K, listener: RecordListener<K>): void {
  offs.push(OBSERVE!.records.subscribe(type, listener));
}
/** The live node delivered beside each re-run record. */
const liveOf = new WeakMap<RerunEvent, Computed<any>>();

afterEach(() => {
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

/** Enable quietly and collect every rerun event. */
function collect(opts?: AttributionOptions): RerunEvent[] {
  attribution.enable({ log: false, ...opts });
  const events: RerunEvent[] = [];
  on("rerun", (e, node) => {
    events.push(e);
    liveOf.set(e, node);
  });
  return events;
}

describe("why-did-this-run attribution", () => {
  it("attributes an effect re-run to the triggering signal write", () => {
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() =>
      createEffect(
        () => count(),
        () => {},
        { name: "counter-effect" }
      )
    );
    flush();

    const events = collect();
    setCount(1);
    flush();

    expect(events).toHaveLength(1);
    expect(events[0].nodeKind).toBe("effect");
    expect(events[0].nodeName).toBe("counter-effect");
    expect(events[0].causes).toHaveLength(1);
    expect(events[0].causes[0]).toMatchObject({
      kind: "write",
      name: "count",
      prev: "0",
      value: "1"
    });
  });

  it("chains attribution through a memo to the root write", () => {
    const [n, setN] = createSignal(1, { name: "notifications" });
    const label = createMemo(() => `msgs: ${n()}`, { name: "label" });
    createRoot(() =>
      createEffect(
        () => label(),
        () => {},
        { name: "title-effect" }
      )
    );
    flush();

    const events = collect();
    setN(2);
    flush();

    const effectRun = events.find(e => e.nodeName === "title-effect")!;
    expect(effectRun).toBeDefined();
    expect(effectRun.causes).toHaveLength(1);
    const cause = effectRun.causes[0];
    expect(cause.kind).toBe("derived");
    expect(cause.name).toBe("label");
    // The derived cause chains to the root write.
    expect(cause.causes).toHaveLength(1);
    expect(cause.causes![0]).toMatchObject({ kind: "write", name: "notifications" });

    // The memo's own re-run is attributed directly to the write.
    const memoRun = events.find(e => e.nodeName === "label")!;
    expect(memoRun.causes[0]).toMatchObject({ kind: "write", name: "notifications" });

    // Every cause carries the identity of the node that changed: the derived
    // cause joins the memo run that produced it by `nodeId`, and the root
    // write carries the signal's id, the same object on both chains.
    expect(cause.nodeId).toBe(memoRun.nodeId);
    expect(typeof cause.causes![0].nodeId).toBe("number");
    expect(cause.causes![0].nodeId).toBe(memoRun.causes[0].nodeId);
    expect(cause.causes![0].nodeId).not.toBe(memoRun.nodeId);
  });

  it("does not attribute downstream re-runs past an equality cutoff", () => {
    const [n, setN] = createSignal(1, { name: "n" });
    const parity = createMemo(() => n() % 2, { name: "parity" });
    createRoot(() =>
      createEffect(
        () => parity(),
        () => {},
        { name: "parity-effect" }
      )
    );
    flush();

    const events = collect();
    setN(3); // parity unchanged: memo re-runs, effect must not
    flush();

    expect(events.map(e => e.nodeName)).toEqual(["parity"]);

    setN(4); // parity flips: both run, effect attributed through the memo
    flush();
    const effectRun = events.find(e => e.nodeName === "parity-effect")!;
    expect(effectRun.causes[0]).toMatchObject({ kind: "derived", name: "parity" });
  });

  it("attributes refresh() re-runs to the self-invalidation", () => {
    const [n] = createSignal(1, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    createRoot(() =>
      createEffect(
        () => doubled(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    const events = collect();
    refresh(doubled);
    flush();

    const memoRun = events.find(e => e.nodeName === "doubled")!;
    expect(memoRun.causes).toHaveLength(1);
    expect(memoRun.causes[0]).toMatchObject({ kind: "refresh", name: "doubled" });
  });

  it("attributes async landings distinctly from sync writes", async () => {
    let resolve!: (v: string) => void;
    const [trigger, setTrigger] = createSignal(0, { name: "trigger" });
    const data = createMemo(
      () => {
        trigger();
        return new Promise<string>(r => (resolve = r));
      },
      { name: "data" }
    );
    createRoot(() =>
      createEffect(
        () => data(),
        () => {},
        { name: "data-effect" }
      )
    );
    flush();
    resolve("first");
    await Promise.resolve();
    flush();

    const events = collect();
    setTrigger(1);
    flush();
    resolve("second");
    await Promise.resolve();
    flush();

    const effectRun = events.filter(e => e.nodeName === "data-effect").at(-1)!;
    expect(effectRun).toBeDefined();
    expect(effectRun.causes.some(c => c.kind === "async" && c.name === "data")).toBe(true);
  });

  it("exposes per-node history via why()", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    createRoot(() =>
      createEffect(
        () => doubled(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    collect();
    setN(1);
    setN(2);
    flush();

    const runs = why(doubled);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every(e => e.nodeName === "doubled")).toBe(true);
  });

  it("formats a readable cause chain", () => {
    const [n, setN] = createSignal(1, { name: "notifications" });
    const label = createMemo(() => `msgs: ${n()}`, { name: "label" });
    createRoot(() =>
      createEffect(
        () => label(),
        () => {},
        { name: "title-effect" }
      )
    );
    flush();

    const events = collect();
    setN(2);
    flush();

    const text = formatRerun(events.find(e => e.nodeName === "title-effect")!);
    expect(text).toContain('effect "title-effect" ran');
    expect(text).toContain('memo "label" changed');
    expect(text).toContain('signal "notifications" write');
    expect(text).toContain("1 → 2");
  });

  it("diffs subscriptions across runs (conditional deps)", () => {
    const [flag, setFlag] = createSignal(true, { name: "flag" });
    const [a] = createSignal("a", { name: "a" });
    const [b] = createSignal("b", { name: "b" });
    createRoot(() =>
      createEffect(
        () => (flag() ? a() : b()),
        () => {},
        { name: "branchy" }
      )
    );
    flush();

    const events = collect();
    setFlag(false);
    flush();

    const run = events.find(e => e.nodeName === "branchy")!;
    expect(run.depsAdded).toEqual(["b"]);
    expect(run.depsRemoved).toEqual(["a"]);
    expect(run.depCount).toBe(2); // flag + b
    expect(formatRerun(run)).toContain('deps changed: +"b" -"a" (2 total)');

    // A run with an unchanged dep set reports no diff.
    setFlag(true);
    flush();
    setFlag(false);
    flush();
    const last = events.filter(e => e.nodeName === "branchy").at(-1)!;
    expect(last.depsAdded).toEqual(["b"]);
    expect(subscriptions(liveOf.get(run)!)).toEqual(["flag", "b"]);
  });

  it("re-run records are serializable: nodeId names the scope, the channel hands back the node", () => {
    const [a, setA] = createSignal(0, { name: "a" });
    let double!: () => number;
    createRoot(() => {
      double = createMemo(() => a() * 2, { name: "double" });
      createEffect(
        () => double(),
        () => {},
        { name: "reader" }
      );
    });
    flush();
    const events = collect();
    setA(1);
    flush();
    setA(2);
    flush();

    const doubles = events.filter(e => e.nodeName === "double");
    const readers = events.filter(e => e.nodeName === "reader");
    expect(doubles.length).toBe(2);
    expect(readers.length).toBe(2);
    // No live reference on the record: it survives the wire as-is.
    for (const e of events) {
      expect(e).not.toHaveProperty("node");
      expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    }
    // One id per scope, stable across its runs, distinct between scopes.
    expect(doubles[0].nodeId).toBe(doubles[1].nodeId);
    expect(readers[0].nodeId).toBe(readers[1].nodeId);
    expect(doubles[0].nodeId).not.toBe(readers[0].nodeId);
    // In-process consumers get the node beside the record on the channel;
    // the engine's own queries still take the accessor.
    const node = liveOf.get(doubles[0]);
    expect(node).toBeDefined();
    expect(liveOf.get(doubles[1])).toBe(node);
    expect(subscriptions(node!)).toEqual(["a"]);
    expect(why(double)).toEqual(doubles);
    expect(why(node)).toEqual(doubles);
    // A copy that left the process names nothing the engine can look up.
    expect(why(JSON.parse(JSON.stringify(doubles[0])))).toEqual([]);
    // By name, for a caller that holds no node (an out-of-process driver
    // through the diagnostics bridge): the `nodeName` filter over history.
    expect(why("double")).toEqual(doubles);
    expect(why("reader")).toEqual(readers);
    expect(why("nobody")).toEqual([]);
  });

  it("warns on hot scopes, once per window", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        () => n(),
        () => {},
        { name: "hot-effect" }
      )
    );
    flush();

    // hotTime disabled: its default 8ms budget is real wall-clock time, and
    // instrumented CI runs (coverage) can exceed it, adding a HOT_SCOPE_TIME
    // warn that breaks the exact console counts below.
    collect({ hotRuns: { count: 3, windowMs: 60_000 }, wideDeps: false, hotTime: false });
    const capture = OBSERVE!.diagnostics.capture();
    for (let i = 1; i <= 5; i++) {
      setN(i);
      flush();
    }

    const hot = capture.stop().filter(e => e.code === "HOT_SCOPE_RERUNS");
    expect(hot).toHaveLength(1); // warned at the 3rd run, muted after
    expect(hot[0].nodeName).toBe("hot-effect");
    expect(hot[0].data).toMatchObject({ runs: 3, windowMs: 60_000 });
    expect(hot[0].message).toContain('"n" (write)');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("aggregates hot scopes sharing a root cause into HOT_SCOPE_FANOUT", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => {
      for (let i = 0; i < 6; i++) {
        createEffect(
          () => n(),
          () => {},
          { name: `watcher-${i}` }
        );
      }
    });
    flush();

    // hotTime disabled — see the hot-scopes test above.
    collect({
      hotRuns: { count: 3, windowMs: 60_000 },
      wideDeps: false,
      fanOut: false,
      hotTime: false
    });
    const capture = OBSERVE!.diagnostics.capture();
    for (let i = 1; i <= 4; i++) {
      setN(i);
      flush();
    }

    const events = capture.stop();
    // First hot scope warns per-node; the other five fold into the cause key.
    const perScope = events.filter(e => e.code === "HOT_SCOPE_RERUNS");
    expect(perScope).toHaveLength(1);
    const fanout = events.filter(e => e.code === "HOT_SCOPE_FANOUT");
    expect(fanout).toHaveLength(1); // milestone at 5 scopes; 6th is silent
    expect(fanout[0].data).toMatchObject({ cause: "n", scopes: 5 });
    expect(warn).toHaveBeenCalledTimes(2); // one victim warning + one aggregate
  });

  it("warns on wide scopes and re-warns only on 50% growth", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const signals = Array.from({ length: 5 }, (_, i) => createSignal(i, { name: `s${i}` }));
    const [bump, setBump] = createSignal(0, { name: "bump" });
    const wide = createMemo(() => bump() + signals.reduce((sum, [get]) => sum + get(), 0), {
      name: "wide-memo"
    });
    createRoot(() =>
      createEffect(
        () => wide(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    // hotTime disabled — see the hot-scopes test above.
    collect({ wideDeps: 4, hotRuns: false, hotTime: false });
    const capture = OBSERVE!.diagnostics.capture();
    setBump(1);
    flush();
    setBump(2); // still 6 deps — under the 1.5x re-warn bar
    flush();

    const wideEvents = capture.stop().filter(e => e.code === "WIDE_SCOPE_DEPS");
    expect(wideEvents).toHaveLength(1);
    expect(wideEvents[0].nodeName).toBe("wide-memo");
    expect(wideEvents[0].data!.depCount).toBe(6); // bump + s0..s4
    expect(wideEvents[0].data!.deps as string[]).toContain("s3");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns on wide scopes at creation time", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const signals = Array.from({ length: 5 }, (_, i) => createSignal(i, { name: `c${i}` }));

    // hotTime disabled — see the hot-scopes test above.
    collect({ wideDeps: 4, hotRuns: false, hotTime: false });
    const capture = OBSERVE!.diagnostics.capture();
    const wide = createMemo(() => signals.reduce((sum, [get]) => sum + get(), 0), {
      name: "born-wide"
    });
    wide(); // pull once so a lazy creation path still computes

    const wideEvents = capture.stop().filter(e => e.code === "WIDE_SCOPE_DEPS");
    expect(wideEvents).toHaveLength(1);
    expect(wideEvents[0].nodeName).toBe("born-wide");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("names store property nodes by path in attribution output", () => {
    // Store node naming is gated on the engine being installed (node
    // creation is the hottest store path), so enable BEFORE the first read
    // creates the property nodes.
    const events = collect();
    const [state, setState] = createStore({ count: 1, other: "x" });
    createRoot(() =>
      createEffect(
        () => state.count,
        () => {},
        { name: "store-reader" }
      )
    );
    flush();

    setState(s => {
      s.count = 2;
    });
    flush();

    const run = events.find(e => e.nodeName === "store-reader")!;
    expect(run).toBeDefined();
    expect(run.causes.some(c => c.name === "store.count")).toBe(true);
  });

  it("a store declared with a name labels its property nodes by that name", () => {
    const events = collect();
    const [todos, setTodos] = createStore({ list: [{ title: "a" }] }, { name: "todos" });
    const [derived] = createStore(
      d => void (d.n = todos.list.length),
      { n: 0 },
      {
        name: "counts"
      }
    );
    createRoot(() => {
      createEffect(
        () => todos.list[0].title,
        () => {},
        { name: "title-reader" }
      );
      createEffect(
        () => derived.n,
        () => {},
        { name: "count-reader" }
      );
    });
    flush();

    setTodos(s => {
      s.list[0].title = "b";
      s.list.push({ title: "c" });
    });
    flush();

    // Nested nodes read the ROOT store's name: the property key is the
    // leaf, the store name the prefix — "todos.title", not "store.title".
    const title = events.find(e => e.nodeName === "title-reader")!;
    expect(title.causes.map(c => c.name)).toContain("todos.title");
    // A derived store names its projection node AND its property nodes.
    const count = events.find(e => e.nodeName === "count-reader")!;
    expect(count.causes.map(c => c.name)).toContain("counts.n");
    expect(events.some(e => e.nodeName === "counts")).toBe(true);
  });

  it("measures self-time and aggregates costs by scope and root write", () => {
    const spin = (ms: number) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
    };
    const [n, setN] = createSignal(0, { name: "n" });
    const slow = createMemo(
      () => {
        spin(10);
        return n();
      },
      { name: "slow-memo" }
    );
    createRoot(() =>
      createEffect(
        () => slow(),
        () => {},
        { name: "cheap-effect" }
      )
    );
    flush();

    const events = collect({ hotTime: false });
    setN(1);
    flush();

    const memoRun = events.find(e => e.nodeName === "slow-memo")!;
    const effectRun = events.find(e => e.nodeName === "cheap-effect")!;
    expect(memoRun.selfMs).toBeGreaterThanOrEqual(5);
    expect(memoRun.totalMs).toBeGreaterThanOrEqual(memoRun.selfMs);
    expect(memoRun.changed).toBe(true);
    expect(effectRun.selfMs).toBeLessThan(memoRun.selfMs);

    const { scopes, writes } = costs();
    expect(scopes[0].name).toBe("slow-memo"); // ranked by self-time
    expect(scopes[0].selfMs).toBeGreaterThanOrEqual(5);
    expect(scopes[0].wastedMs).toBe(0); // value changed — not waste
    const rootWrite = writes.find(w => w.name === "n")!;
    expect(rootWrite).toBeDefined();
    expect(rootWrite.downstreamMs).toBeGreaterThanOrEqual(memoRun.selfMs);
    expect(rootWrite.runs).toBeGreaterThanOrEqual(2); // memo + effect
  });

  it("counts unchanged-value runs as wasted time", () => {
    const spin = (ms: number) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
    };
    const [n, setN] = createSignal(1, { name: "n" });
    const wastefulMemo = createMemo(
      () => {
        n();
        spin(6);
        return "constant";
      },
      { name: "wasteful" }
    );
    createRoot(() =>
      createEffect(
        () => wastefulMemo(),
        () => {},
        { name: "w-consumer" }
      )
    );
    flush();

    collect({ hotTime: false });
    setN(2); // memo re-runs, produces the same value — pure waste
    flush();

    const { scopes } = costs();
    const wasteful = scopes.find(s => s.name === "wasteful")!;
    expect(wasteful.wastedMs).toBeGreaterThanOrEqual(4);
    expect(wasteful.wastedMs).toBe(wasteful.selfMs);
  });

  it("derives honest changed for effects: identical compute output is waste", () => {
    // Core runs effects with `_equals: false` (the effect phase re-fires on
    // every recompute), so its changed flag is unconditionally true for
    // effects — the engine must re-derive the fact or effect waste (the
    // compiled-JSX fan-out signature, e.g. every row recomputing an
    // identical class string on selection) is invisible to costs().
    const [selected, setSelected] = createSignal(-1, { name: "selected" });
    createRoot(() =>
      createEffect(
        () => (selected() === 99 ? "danger" : ""),
        () => {},
        { name: "row-class" }
      )
    );
    flush();

    const events = collect();
    setSelected(1); // output stays "" — pure waste
    flush();
    setSelected(99); // output flips to "danger" — a real change
    flush();

    const [wasted, real] = events.filter(e => e.nodeName === "row-class");
    expect(wasted.changed).toBe(false);
    expect(real.changed).toBe(true);
    const { scopes } = costs();
    const scope = scopes.find(s => s.name === "row-class")!;
    expect(scope.wastedMs).toBeGreaterThanOrEqual(0);
    expect(scope.wastedMs).toBe(wasted.selfMs);
  });

  it("exempts undefined-output effects from the waste derivation", () => {
    // A side-effect-only compute returns undefined every run; identity of
    // undefined proves nothing about the work, so these stay changed: true.
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        () => {
          n();
        },
        () => {},
        { name: "void-effect" }
      )
    );
    flush();

    const events = collect();
    setN(1);
    flush();

    const run = events.find(e => e.nodeName === "void-effect")!;
    expect(run.changed).toBe(true);
    const { scopes } = costs();
    expect(scopes.find(s => s.name === "void-effect")!.wastedMs).toBe(0);
  });

  it("warns when a scope exceeds its time budget in one window", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spin = (ms: number) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
    };
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        () => {
          n();
          spin(6);
        },
        () => {},
        { name: "budget-buster" }
      )
    );
    flush();

    collect({ hotRuns: false, hotTime: { budgetMs: 5, windowMs: 60_000 } });
    const capture = OBSERVE!.diagnostics.capture();
    setN(1);
    flush();
    setN(2); // still inside the window — warned once, then muted
    flush();

    const timeEvents = capture.stop().filter(e => e.code === "HOT_SCOPE_TIME");
    expect(timeEvents).toHaveLength(1);
    expect(timeEvents[0].nodeName).toBe("budget-buster");
    expect(timeEvents[0].data!.spentMs as number).toBeGreaterThanOrEqual(5);
    expect(timeEvents[0].message).toContain('"n" (write)');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("tags optimistic runs with their phase and never blames them as waste", () => {
    const spin = (ms: number) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
    };
    const [x, setX] = createOptimistic(1, { name: "opt" });
    createRoot(() =>
      createEffect(
        () => {
          spin(3);
          return x();
        },
        () => {},
        { name: "opt-effect" }
      )
    );
    flush();

    const events = collect({ hotRuns: false, hotTime: false });
    setX(2);
    flush();

    const runs = events.filter(e => e.nodeName === "opt-effect");
    expect(runs.length).toBeGreaterThanOrEqual(1);
    // Every run under the optimistic write is tagged as overlay work.
    for (const run of runs) expect(run.phase).not.toBe("plain");

    const { scopes } = costs();
    const scope = scopes.find(s => s.name === "opt-effect")!;
    expect(scope.overlayMs).toBeGreaterThan(0);
    expect(scope.wastedMs).toBe(0); // overlay runs are never waste
    expect(scope.selfMs).toBeGreaterThanOrEqual(scope.overlayMs);
  });

  it("keeps plain runs untagged", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        () => n(),
        () => {},
        { name: "plain-effect" }
      )
    );
    flush();

    const events = collect();
    setN(1);
    flush();

    const run = events.find(e => e.nodeName === "plain-effect")!;
    expect(run.phase).toBe("plain");
    expect(run.held).toBe(false);
  });

  it("is inert when disabled", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        () => n(),
        () => {},
        { name: "e" }
      )
    );
    flush();
    const events: RerunEvent[] = [];
    on("rerun", e => events.push(e));
    setN(1);
    flush();
    expect(events).toHaveLength(0);
    expect(attribution.history("rerun")).toHaveLength(0);
  });
});

describe("shared engine: holds, releases, layered options", () => {
  function counter() {
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        () => n(),
        () => {},
        { name: "e" }
      )
    );
    flush();
    return setN;
  }

  it("stays installed until the last hold is released", () => {
    const setN = counter();
    const first: RerunEvent[] = [];
    const second: RerunEvent[] = [];
    const releaseFirst = attribution.enable({ log: false });
    on("rerun", e => first.push(e));
    const releaseSecond = attribution.enable({ log: false });
    on("rerun", e => second.push(e));

    setN(1);
    flush();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    // One consumer leaves: the other keeps receiving.
    releaseFirst();
    releaseFirst(); // idempotent: not the second consumer's hold
    setN(2);
    flush();
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);

    // The last one leaves: the engine uninstalls, so nothing further is
    // recorded — the channel subscriptions themselves are the consumers' to
    // release and are untouched.
    releaseSecond();
    setN(3);
    flush();
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(attribution.history("rerun")).toHaveLength(0);
  });

  it("opens a fresh window on every enable without uninstalling", () => {
    const setN = counter();
    const release = attribution.enable({ log: false });
    setN(1);
    flush();
    expect(attribution.history("rerun")).toHaveLength(1);

    // A second consumer arrives (say, a capture): it reads back only what
    // happens from here on.
    const releaseCapture = attribution.enable({ log: false });
    expect(attribution.history("rerun")).toHaveLength(0);
    setN(2);
    flush();
    expect(attribution.history("rerun")).toHaveLength(1);
    releaseCapture();
    release();
  });

  it("options combine by the most demanding request, whatever the order of the holds", () => {
    const setN = counter();
    const events: RerunEvent[] = [];
    // One `console.log` per logged re-run on either path (plain, or the
    // grouped one whose body is the `log` call).
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const logs = () => logged.mock.calls.length;
    // A track asks for no log.
    const releaseTrack = attribution.enable({ log: false, hotRuns: false, hotTime: false });
    on("rerun", e => events.push(e));
    setN(1);
    flush();
    expect(logs()).toBe(0);

    // A console session arrives wanting the log (the default): it prints —
    // the later hold adds to what the engine does, and the earlier one
    // cannot deny it.
    const releaseConsole = attribution.enable({ hotRuns: false, hotTime: false, wideDeps: false });
    setN(2);
    flush();
    expect(logs()).toBe(1);
    expect(events).toHaveLength(2);

    // The track leaves: the session's log is untouched.
    releaseTrack();
    setN(3);
    flush();
    expect(logs()).toBe(2);

    // The track comes back beside the session: still printing — the same
    // pair of requests gives the same result in the other order.
    const releaseTrack2 = attribution.enable({ log: false, hotRuns: false, hotTime: false });
    setN(4);
    flush();
    expect(logs()).toBe(3);

    // The session leaves: only the track's request remains — quiet.
    releaseConsole();
    setN(5);
    flush();
    expect(logs()).toBe(3);
    releaseTrack2();
  });

  it("a check runs while any holder wants it, at the most sensitive threshold requested", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setN = counter();
    // A records-only adapter.
    const releaseAdapter = attribution.enable({ log: false, checks: false });
    const capture = OBSERVE!.diagnostics.capture();
    for (let i = 1; i <= 5; i++) {
      setN(i);
      flush();
    }
    const hot = () => capture.stop().filter(e => e.code === "HOT_SCOPE_RERUNS").length;
    expect(hot()).toBe(0);

    // A capture beside it asks for the hot-runs check at 3 runs: it runs,
    // for the adapter's writes too, while the capture holds.
    const capture2 = OBSERVE!.diagnostics.capture();
    const releaseCapture = attribution.enable({
      log: false,
      hotRuns: { count: 3, windowMs: 60_000 },
      hotTime: false,
      wideDeps: false
    });
    for (let i = 6; i <= 10; i++) {
      setN(i);
      flush();
    }
    expect(capture2.stop().filter(e => e.code === "HOT_SCOPE_RERUNS")).toHaveLength(1);

    // The capture leaves: records only again.
    releaseCapture();
    const capture3 = OBSERVE!.diagnostics.capture();
    for (let i = 11; i <= 20; i++) {
      setN(i);
      flush();
    }
    expect(capture3.stop().filter(e => e.code === "HOT_SCOPE_RERUNS")).toHaveLength(0);
    releaseAdapter();
  });

  it("an explicit undefined is unsaid: the default stands", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setN = counter();
    const release = attribution.enable({
      log: false,
      hotRuns: { count: 2, windowMs: 60_000 },
      hotTime: false,
      wideDeps: undefined
    });
    const capture = OBSERVE!.diagnostics.capture();
    for (let i = 1; i <= 5; i++) {
      setN(i);
      flush();
    }
    // hotRuns as asked; wideDeps at its default (no finding for one dep either way).
    expect(capture.stop().filter(e => e.code === "HOT_SCOPE_RERUNS")).toHaveLength(1);
    release();
  });

  it("disable() tears down whatever holds are outstanding", () => {
    const setN = counter();
    const events: RerunEvent[] = [];
    // A consumer that re-enables to reopen its window and then calls disable()
    // once — the pre-token idiom — leaves nothing behind.
    const release = attribution.enable({ log: false });
    attribution.enable({ log: false });
    on("rerun", e => events.push(e));
    attribution.disable();
    setN(1);
    flush();
    expect(events).toHaveLength(0);
    expect(attribution.history("rerun")).toHaveLength(0);
    release(); // a release after the teardown is a no-op
    setN(2);
    flush();
    expect(attribution.history("rerun")).toHaveLength(0);
  });

  it("disable without a matching enable is a full, idempotent reset", () => {
    const setN = counter();
    attribution.disable();
    attribution.disable();
    const events: RerunEvent[] = [];
    on("rerun", e => events.push(e));
    setN(1);
    flush();
    expect(events).toHaveLength(0);
  });

  it("checks: false folds every cost check out while records keep flowing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setN = counter();
    const events = collect({ checks: false, hotRuns: { count: 2, windowMs: 60_000 } });
    const capture = OBSERVE!.diagnostics.capture();
    for (let i = 1; i <= 5; i++) {
      setN(i);
      flush();
    }
    expect(events).toHaveLength(5);
    expect(capture.stop().filter(e => e.code === "HOT_SCOPE_RERUNS")).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("checks defaults on: the same run warns", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setN = counter();
    collect({ hotRuns: { count: 2, windowMs: 60_000 }, hotTime: false, wideDeps: false });
    const capture = OBSERVE!.diagnostics.capture();
    for (let i = 1; i <= 5; i++) {
      setN(i);
      flush();
    }
    expect(capture.stop().filter(e => e.code === "HOT_SCOPE_RERUNS")).toHaveLength(1);
  });
});
