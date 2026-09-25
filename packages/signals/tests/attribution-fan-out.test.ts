import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  refresh,
  OBSERVE
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";
import { GRAPH_SIZE_WARN_AT, GRAPH_SIZE_WARN_EVERY } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

/** Enable quietly and capture HUGE_FAN_OUT diagnostics. */
function captureFanOut(fanOut: number | false = 250) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, fanOut });
  const events: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "HUGE_FAN_OUT") events.push(e);
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

// The engine's lower-threshold reporter of the always-on HUGE_FAN_OUT: same
// code, same `data.count`, plus `data.write` naming the root invalidation.
describe("HUGE_FAN_OUT from the attribution engine's fanOut threshold", () => {
  it("warns once when a write reaches the subscriber threshold", () => {
    const [selectedId, setSelectedId] = createSignal(0, { name: "selectedId" });
    subscribeN(() => selectedId(), 30);

    const events = captureFanOut(25);
    setSelectedId(1);
    flush();
    setSelectedId(2); // same node, same size — muted
    flush();

    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("HUGE_FAN_OUT");
    expect(events[0].kind).toBe("graph");
    expect(events[0].severity).toBe("warn");
    expect(events[0].nodeName).toBe("selectedId");
    expect(events[0].data).toEqual({ count: 30, write: "write" });
    expect(events[0].message).toContain('[HUGE_FAN_OUT] Signal "selectedId" changed with 30 subscribers');
    // The repair must name an API 2.0 ships (#3304).
    expect(events[0].message).toContain("per-key store or projection");
    expect(events[0].message).not.toContain("createSelector");
  });

  it("re-warns only once the subscriber count has grown by GRAPH_SIZE_WARN_EVERY", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), 30);

    const events = captureFanOut(25);
    setN(1);
    flush();
    expect(events).toHaveLength(1);

    subscribeN(() => n(), GRAPH_SIZE_WARN_EVERY - 10); // under the growth step
    setN(2);
    flush();
    expect(events).toHaveLength(1);

    subscribeN(() => n(), 20); // past it
    setN(3);
    flush();
    expect(events).toHaveLength(2);
    expect(events[1].data!.count as number).toBeGreaterThanOrEqual(30 + GRAPH_SIZE_WARN_EVERY);
  });

  it("hands over to the always-on check at GRAPH_SIZE_WARN_AT — one finding per write", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), GRAPH_SIZE_WARN_AT);

    const events = captureFanOut(25);
    setN(1);
    flush();

    // The core's notify-walk count fired; the engine did not add a second.
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    expect(events[0].message).toContain('Signal "n" changed with');
  });

  it("fires for refresh() invalidations of wide memos", () => {
    const [n] = createSignal(1, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    subscribeN(() => doubled(), 30);

    const events = captureFanOut(25);
    refresh(doubled);
    flush();

    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("doubled");
    expect(events[0].data).toMatchObject({ write: "refresh" });
    expect(events[0].message).toContain('Signal "doubled" changed with');
  });

  it("stays quiet under the threshold and for unchanged writes", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), 30);

    const events = captureFanOut(31);
    setN(1); // 30 subscribers < 31
    flush();
    expect(events).toHaveLength(0);

    const wide = captureFanOut(25);
    setN(1); // equality gate: same value commits nothing, stamps nothing
    flush();
    expect(wide).toHaveLength(0);
  });

  it("can be disabled, leaving only the always-on threshold", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    subscribeN(() => n(), 30);

    const events = captureFanOut(false);
    setN(1);
    flush();
    expect(events).toHaveLength(0);
  });
});
