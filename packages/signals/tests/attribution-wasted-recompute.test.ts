/**
 * WASTED_RECOMPUTE — a scope whose equality gate closes almost every time.
 *
 * Claim under test: a scope that re-runs `minRuns`+ times in a window, with
 * `ratio` or more of the runs producing an unchanged value and `budgetMs`+ of
 * compute in all, is reported once per window with the input that keeps
 * triggering it. Runs that change the value, held/overlay runs, and a scope
 * whose waste is cheap are not reported. `checks: false` folds it off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, costs } from "../src/attribution.js";
import type { AttributionOptions } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createProjection,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

const WASTE = { minRuns: 5, ratio: 0.8, budgetMs: 0, windowMs: 60_000 };

function capture(opts: AttributionOptions = {}) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    unstableMemos: false,
    wastedRecompute: WASTE,
    ...opts
  });
  const events: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "WASTED_RECOMPUTE") events.push(e);
  });
  return { events, warn };
}

/** A memo over a whole object that only uses one field: every write to the other field is waste. */
function coarseReader() {
  const [user, setUser] = createSignal({ name: "Ada", visits: 0 }, { name: "user" });
  const greeting = createMemo(() => `Hello, ${user().name}`, { name: "greeting" });
  createRoot(() =>
    createEffect(
      () => greeting(),
      () => {},
      { name: "header" }
    )
  );
  flush();
  return { setUser, greeting };
}

describe("WASTED_RECOMPUTE", () => {
  it("warns once when most of a scope's runs in the window changed nothing", () => {
    const { setUser, greeting } = coarseReader();
    const { events, warn } = capture();
    for (let i = 1; i <= 8; i++) {
      setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(greeting()).toBe("Hello, Ada");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: "WASTED_RECOMPUTE",
      kind: "perf",
      severity: "warn",
      nodeName: "greeting",
      data: { runs: 5, wasted: 5, windowMs: 60_000, causes: ["user"] }
    });
    expect(events[0].message).toContain('memo "greeting" re-ran 5 times');
    expect(events[0].message).toContain("equality boundary upstream");
    expect(events[0].message).toContain('Latest cause: "user" (write)');
    expect(warn).toHaveBeenCalled();
  });

  it("a scope whose runs change its value is not waste", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    createRoot(() =>
      createEffect(
        () => doubled(),
        () => {},
        { name: "reader" }
      )
    );
    flush();
    const { events } = capture();
    for (let i = 1; i <= 8; i++) {
      setN(i);
      flush();
    }
    expect(events).toHaveLength(0);
  });

  it("below the ratio, below the run count, or under the budget: silent", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    // Changes every other run: 50% waste, under the 80% ratio.
    const half = createMemo(() => Math.floor(n() / 2), { name: "half" });
    createRoot(() =>
      createEffect(
        () => half(),
        () => {},
        { name: "reader" }
      )
    );
    flush();
    const { events } = capture();
    for (let i = 1; i <= 10; i++) {
      setN(i);
      flush();
    }
    expect(events).toHaveLength(0);

    attribution.disable();
    const few = coarseReader();
    const under = capture({ wastedRecompute: { ...WASTE, minRuns: 20 } });
    for (let i = 1; i <= 8; i++) {
      few.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(under.events).toHaveLength(0);

    attribution.disable();
    const cheap = coarseReader();
    const budget = capture({ wastedRecompute: { ...WASTE, budgetMs: 10_000 } });
    for (let i = 1; i <= 8; i++) {
      cheap.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(budget.events).toHaveLength(0);
  });

  it("`checks: false` folds it off with the other cost checks; `false` alone disables it", () => {
    const a = coarseReader();
    const off = capture({ checks: false });
    for (let i = 1; i <= 8; i++) {
      a.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(off.events).toHaveLength(0);

    attribution.disable();
    const b = coarseReader();
    const disabled = capture({ wastedRecompute: false });
    for (let i = 1; i <= 8; i++) {
      b.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(disabled.events).toHaveLength(0);
  });

  describe("computeds whose value is undefined", () => {
    function run(make: (x: () => number) => () => unknown) {
      const [x, setX] = createSignal(0, { name: "x" });
      let read!: () => unknown;
      createRoot(() => {
        read = make(x);
      });
      flush();
      const { events } = capture();
      for (let i = 1; i <= 10; i++) {
        setX(i);
        flush();
        read();
      }
      return events;
    }

    it("a projection that mutates its draft is not waste", () => {
      const events = run(x => {
        const s = createProjection<{ v: number }>(
          d => {
            d.v = x();
          },
          { v: 0 },
          { name: "draft projection" }
        );
        return () => s.v;
      });
      expect(events).toHaveLength(0);
      // Every consumer reads the same fact: the records and costs() agree.
      const reruns = attribution.history("rerun").filter(e => e.nodeName === "draft projection");
      expect(reruns).toHaveLength(10);
      expect(reruns.every(e => e.changed)).toBe(true);
      const scope = costs().scopes.find(s => s.name === "draft projection");
      expect(scope?.runs).toBe(10);
      expect(scope?.wastedMs).toBe(0);
    });

    it("a projection that returns a value to reconcile is not waste", () => {
      const events = run(x => {
        const s = createProjection(() => ({ v: x() }), { v: 0 }, { name: "returning projection" });
        return () => s.v;
      });
      expect(events).toHaveLength(0);
    });

    it("a memo that returns undefined and does its work by writing is not waste", () => {
      const [y, setY] = createSignal(0, { name: "y", ownedWrite: true });
      const events = run(x => {
        createMemo(
          () => {
            setY(x() * 2);
          },
          { name: "sweep memo" }
        );
        return y;
      });
      expect(y()).toBe(20);
      expect(events).toHaveLength(0);
    });

    it("a memo that keeps returning the same defined value is still waste", () => {
      const events = run(x => createMemo(() => (x(), 7), { name: "constant memo" }));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ nodeName: "constant memo" });
    });
  });
});
