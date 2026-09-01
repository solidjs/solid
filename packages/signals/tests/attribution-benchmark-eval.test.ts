/**
 * DESIGN EVALUATION — benchmark-shaped scenarios for the attribution detectors.
 *
 * Question under test: if these detectors ran against the real perf mistakes
 * we see in benchmarks (JS Framework Benchmark shapes), would they identify
 * them — and do they stay quiet on the correctly-written versions?
 *
 * Each scenario models the signals-level shape the compiled JSX produces:
 * one render effect per row binding.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  DEV,
  flush
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";
import type { RerunEvent } from "../src/core/attribution.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm(opts: Parameters<typeof DEV.attribution.enable>[0] = {}) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false, ...opts });
  const diagnostics: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => diagnostics.push(e));
  const reruns: RerunEvent[] = [];
  DEV!.attribution.subscribe(e => reruns.push(e));
  return { diagnostics, reruns };
}

const codes = (events: DiagnosticEvent[]) => events.map(e => e.code);

describe("JSFB select-row (naive: every row reads the selected signal)", () => {
  function naiveRows(n: number) {
    const [selected, setSelected] = createSignal(-1, { name: "selectedId" });
    createRoot(() => {
      for (let i = 0; i < n; i++) {
        createEffect(
          () => (selected() === i ? "danger" : ""),
          () => {},
          { name: `row-${i}.class` }
        );
      }
    });
    flush();
    return setSelected;
  }

  it("WIDE_WRITE identifies the selection fan-out at default thresholds", () => {
    const setSelected = naiveRows(1000);
    const { diagnostics, reruns } = arm();

    setSelected(3);
    flush();
    setSelected(7);
    flush();

    // The culprit is named: the write to selectedId, with its subscriber count.
    const wide = diagnostics.filter(e => e.code === "WIDE_WRITE");
    expect(wide).toHaveLength(1);
    expect(wide[0].nodeName).toBe("selectedId");
    expect(wide[0].data!.subscribers).toBe(1000);
    expect(wide[0].message).toContain("createSelector or createProjection");

    // FINDING (F2), now fixed engine-side: effects run with `_equals: false`,
    // so CORE reports every effect recompute as changed — which made effect
    // waste invisible to costs() (and compiled JSX bindings are effects).
    // The engine now re-derives effect-output change from frame.prevValue:
    // 1997 of the 2000 row runs are honest waste.
    expect(reruns).toHaveLength(2000);
    const unchanged = reruns.filter(r => !r.changed).length;
    expect(unchanged).toBeGreaterThanOrEqual(1996);
    const { scopes } = DEV!.attribution.costs();
    const wastedTotal = scopes
      .filter(s => s.name.endsWith(".class"))
      .reduce((sum, s) => sum + s.wastedMs, 0);
    expect(wastedTotal).toBeGreaterThan(0);

    // The write-cost table ranks selectedId as the top root cause.
    const { writes } = DEV!.attribution.costs();
    expect(writes[0].name).toBe("selectedId");
    expect(writes[0].runs).toBe(2000);

    // The per-scope detectors correctly do NOT fire: each row ran only twice.
    expect(codes(diagnostics)).not.toContain("HOT_SCOPE_RERUNS");
    expect(codes(diagnostics)).not.toContain("WIDE_SCOPE_DEPS");
  });

  it("rapid selection: HOT_SCOPE_RERUNS fires per ROW (victim), not per cause", () => {
    // 50 rows, 12 selects inside one window. Every row effect re-ran 12
    // times — the hot detector's per-node bookkeeping warns once per row.
    // This documents the spam shape: N row warnings for 1 real culprit.
    const setSelected = naiveRows(50);
    const { diagnostics } = arm({
      hotRuns: { count: 10, windowMs: 60_000 },
      wideWrites: 25,
      hotTime: false
    });

    for (let i = 0; i < 12; i++) {
      setSelected(i);
      flush();
    }

    const hot = diagnostics.filter(e => e.code === "HOT_SCOPE_RERUNS");
    // Documenting current behavior — one warning per row scope.
    expect(hot.length).toBe(50);
    // WIDE_WRITE fired once and named the actual culprit.
    expect(diagnostics.filter(e => e.code === "WIDE_WRITE")).toHaveLength(1);
  });

  it("stays quiet on the selector-inverted version (the correct fix)", () => {
    // Hand-rolled createSelector shape: per-row signals, one effect keyed off
    // selectedId flips exactly the rows whose answer changed.
    const n = 1000;
    const [selected, setSelected] = createSignal(-1, { name: "selectedId" });
    const rowSelected: ((v: boolean) => void)[] = [];
    createRoot(() => {
      for (let i = 0; i < n; i++) {
        const [isSel, setIsSel] = createSignal(false, { name: `row-${i}.selected` });
        rowSelected.push(setIsSel);
        createEffect(
          () => (isSel() ? "danger" : ""),
          () => {},
          { name: `row-${i}.class` }
        );
      }
      let prev = -1;
      createEffect(
        () => selected(),
        id => {
          if (prev >= 0) rowSelected[prev](false);
          if (id >= 0) rowSelected[id](true);
          prev = id;
        },
        { name: "selection-inverter" }
      );
    });
    flush();

    const { diagnostics, reruns } = arm();
    setSelected(3);
    flush();
    setSelected(7);
    flush();

    // Zero perf diagnostics, and only the touched rows ran.
    expect(diagnostics.filter(e => e.kind === "perf")).toHaveLength(0);
    const rowRuns = reruns.filter(r => r.nodeName.endsWith(".class"));
    expect(rowRuns.length).toBe(3); // row-3 on, row-3 off, row-7 on
    expect(rowRuns.every(r => r.changed)).toBe(true);
  });
});

describe("JSFB derived-list shapes", () => {
  it("UNSTABLE_MEMO_OUTPUT catches the rebuilt-but-equivalent visible-rows memo", () => {
    // The classic: `visible = createMemo(() => rows().filter(...))` re-runs on
    // an unrelated hot input and returns a fresh array of the SAME row refs.
    // Equality gate never closes; every subscriber re-runs every time. Waste
    // accounting cannot see this (changed === true), so the unstable detector
    // is the only structural catch.
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, active: i % 2 === 0 }));
    const [tick, setTick] = createSignal(0, { name: "tick" });
    const [all] = createSignal(rows, { name: "rows" });
    const visible = createMemo(
      () => {
        tick(); // unrelated hot dependency leaked into the derivation
        return all().filter(r => r.active);
      },
      { name: "visibleRows" }
    );
    let consumerRuns = 0;
    createRoot(() =>
      createEffect(
        () => {
          visible();
          consumerRuns++;
        },
        () => {},
        { name: "list-renderer" }
      )
    );
    flush();

    const { diagnostics } = arm();
    for (let i = 1; i <= 5; i++) {
      setTick(i);
      flush();
    }

    const unstable = diagnostics.filter(e => e.code === "UNSTABLE_MEMO_OUTPUT");
    expect(unstable).toHaveLength(1);
    expect(unstable[0].nodeName).toBe("visibleRows");
    // And the downstream damage is real: the consumer re-ran every time.
    expect(consumerRuns).toBe(6); // 1 create + 5 amplified re-runs
  });
});

describe("healthy fine-grained benchmark implementation (false-positive control)", () => {
  it("update-every-10th-row over a store emits zero perf diagnostics", () => {
    const n = 1000;
    const [state, setState] = createStore({
      rows: Array.from({ length: n }, (_, i) => ({ id: i, label: `row ${i}` }))
    });
    createRoot(() => {
      for (let i = 0; i < n; i++) {
        createEffect(
          () => state.rows[i].label,
          () => {},
          { name: `row-${i}.text` }
        );
      }
    });
    flush();

    const { diagnostics, reruns } = arm();
    setState(s => {
      for (let i = 0; i < n; i += 10) s.rows[i].label += " !!!";
    });
    flush();

    expect(diagnostics.filter(e => e.kind === "perf")).toHaveLength(0);
    // Exactly the 100 touched rows ran, all committing changes.
    const rowRuns = reruns.filter(r => r.nodeName.endsWith(".text"));
    expect(rowRuns.length).toBe(100);
    expect(rowRuns.every(r => r.changed)).toBe(true);
  });
});
