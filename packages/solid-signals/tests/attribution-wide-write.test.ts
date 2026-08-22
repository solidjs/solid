import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  DEV,
  flush,
  refresh
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

/** Enable quietly and capture WIDE_WRITE diagnostics. */
function captureWideWrites(wideWrites: number | false = 250) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false, wideWrites });
  const events: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => {
    if (e.code === "WIDE_WRITE") events.push(e);
  });
  return events;
}

function subscribeN(read: () => unknown, n: number): void {
  createRoot(() => {
    for (let i = 0; i < n; i++) {
      createEffect(read, () => {});
    }
  });
  flush();
}

describe("WIDE_WRITE", () => {
  it("warns once when a write reaches the subscriber threshold", () => {
    const [selectedId, setSelectedId] = createSignal(0, { name: "selectedId" });
    subscribeN(() => selectedId(), 30);

    const events = captureWideWrites(25);
    setSelectedId(1);
    flush();
    setSelectedId(2); // same node, same size — muted
    flush();

    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("selectedId");
    expect(events[0].data).toMatchObject({ subscribers: 30, write: "write" });
    expect(events[0].message).toContain("createSelector or createProjection");
  });

  it("re-warns only after the subscriber count doubles", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), 30);

    const events = captureWideWrites(25);
    setN(1);
    flush();
    expect(events).toHaveLength(1);

    subscribeN(() => n(), 25); // 55 total — under 2x of 30
    setN(2);
    flush();
    expect(events).toHaveLength(1);

    subscribeN(() => n(), 10); // 65 total — past 2x of 30
    setN(3);
    flush();
    expect(events).toHaveLength(2);
    expect(events[1].data!.subscribers as number).toBeGreaterThanOrEqual(60);
  });

  it("fires for refresh() invalidations of wide memos", () => {
    const [n] = createSignal(1, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    subscribeN(() => doubled(), 30);

    const events = captureWideWrites(25);
    refresh(doubled);
    flush();

    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("doubled");
    expect(events[0].data).toMatchObject({ write: "refresh" });
    expect(events[0].message).toContain('refresh of "doubled"');
  });

  it("stays quiet under the threshold and for unchanged writes", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), 30);

    const events = captureWideWrites(31);
    setN(1); // 30 subscribers < 31
    flush();
    expect(events).toHaveLength(0);

    const wide = captureWideWrites(25);
    setN(1); // equality gate: same value commits nothing, stamps nothing
    flush();
    expect(wide).toHaveLength(0);
  });

  it("can be disabled", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), 30);

    const events = captureWideWrites(false);
    setN(1);
    flush();
    expect(events).toHaveLength(0);
  });
});
