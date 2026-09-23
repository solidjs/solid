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
import { attribution } from "../src/attribution.js";
import type { AttributionOptions } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
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
});
