import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  createStore,
  DEV,
  flush,
  refresh
} from "../src/index.js";
import type { AttributionOptions, RerunEvent } from "../src/core/attribution.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

/** Enable quietly and collect every rerun event. */
function collect(opts?: AttributionOptions): RerunEvent[] {
  DEV!.attribution.enable({ log: false, ...opts });
  const events: RerunEvent[] = [];
  DEV!.attribution.subscribe(e => events.push(e));
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

    const runs = DEV!.attribution.why(doubled);
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

    const text = DEV!.attribution.format(events.find(e => e.nodeName === "title-effect")!);
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
    expect(DEV!.attribution.format(run)).toContain('deps changed: +"b" -"a" (2 total)');

    // A run with an unchanged dep set reports no diff.
    setFlag(true);
    flush();
    setFlag(false);
    flush();
    const last = events.filter(e => e.nodeName === "branchy").at(-1)!;
    expect(last.depsAdded).toEqual(["b"]);
    expect(DEV!.attribution.subscriptions(run.node)).toEqual(["flag", "b"]);
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

    collect({ hotRuns: { count: 3, windowMs: 60_000 }, wideDeps: false });
    const capture = DEV!.diagnostics.capture();
    for (let i = 1; i <= 5; i++) {
      setN(i);
      flush();
    }

    const hot = capture.stop().filter(e => e.code === "HOT_SCOPE_RERUNS");
    expect(hot).toHaveLength(1); // warned at the 3rd run, muted after
    expect(hot[0].nodeName).toBe("hot-effect");
    expect(hot[0].data).toMatchObject({ runs: 3, windowMs: 60_000 });
    expect(hot[0].message).toContain('"n" (write)');
    // Count THIS diagnostic's warns, not the process-global total — other
    // suites in a reused worker may legitimately warn (e.g. store getter
    // demotion notices), and a global count is flaky by construction.
    const hotWarns = warn.mock.calls.filter(c => String(c[0]).includes('"n" (write)'));
    expect(hotWarns).toHaveLength(1);
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

    collect({ wideDeps: 4, hotRuns: false });
    const capture = DEV!.diagnostics.capture();
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

    collect({ wideDeps: 4, hotRuns: false });
    const capture = DEV!.diagnostics.capture();
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

    const { scopes, writes } = DEV!.attribution.costs();
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

    const { scopes } = DEV!.attribution.costs();
    const wasteful = scopes.find(s => s.name === "wasteful")!;
    expect(wasteful.wastedMs).toBeGreaterThanOrEqual(4);
    expect(wasteful.wastedMs).toBe(wasteful.selfMs);
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
    const capture = DEV!.diagnostics.capture();
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

    const { scopes } = DEV!.attribution.costs();
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
    DEV!.attribution.subscribe(e => events.push(e));
    setN(1);
    flush();
    expect(events).toHaveLength(0);
    expect(DEV!.attribution.history()).toHaveLength(0);
  });
});
