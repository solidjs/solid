import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, createRoot, createSignal, DEV, flush } from "../src/index.js";
import { GRAPH_SIZE_WARN_AT, GRAPH_SIZE_WARN_EVERY } from "../src/core/dev.js";

afterEach(() => {
  flush();
  vi.restoreAllMocks();
});

function captureGraphEvents() {
  const capture = DEV!.diagnostics.capture();
  return {
    events: () => capture.events.filter(e => e.code === "HUGE_FAN_OUT" || e.code === "HUGE_FAN_IN"),
    stop: () => capture.stop()
  };
}

describe("graph-size diagnostics", () => {
  it("warns HUGE_FAN_OUT when one signal reaches the subscriber threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const [value] = createSignal(0, { name: "hot-source" });
    const dispose = createRoot(d => {
      for (let i = 0; i < GRAPH_SIZE_WARN_AT; i++) {
        createEffect(
          () => value(),
          () => {}
        );
      }
      return d;
    });
    flush();
    const events = cap.events();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("HUGE_FAN_OUT");
    expect(events[0].severity).toBe("warn");
    expect(events[0].nodeName).toBe("hot-source");
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[HUGE_FAN_OUT]"));
    expect(warn.mock.calls[0][0]).toContain(`has ${GRAPH_SIZE_WARN_AT} subscribers`);
    cap.stop();
    dispose();
    flush();
  });

  it("warns HUGE_FAN_IN when one computation reaches the source threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const signals = Array.from({ length: GRAPH_SIZE_WARN_AT }, (_, i) => createSignal(i));
    const dispose = createRoot(d => {
      createEffect(
        () => {
          for (const [read] of signals) read();
        },
        () => {},
        { name: "wide-reader" }
      );
      return d;
    });
    flush();
    const events = cap.events();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("HUGE_FAN_IN");
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[HUGE_FAN_IN]"));
    cap.stop();
    dispose();
    flush();
  });

  it("re-warns at the repeat interval, not on every link past the threshold", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const [value] = createSignal(0);
    const dispose = createRoot(d => {
      for (let i = 0; i < GRAPH_SIZE_WARN_AT + GRAPH_SIZE_WARN_EVERY; i++) {
        createEffect(
          () => value(),
          () => {}
        );
      }
      return d;
    });
    flush();
    const events = cap.events();
    expect(events).toHaveLength(2);
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    expect(events[1].data).toEqual({ count: GRAPH_SIZE_WARN_AT + GRAPH_SIZE_WARN_EVERY });
    cap.stop();
    dispose();
    flush();
  });

  it("unlink decrements the count — a rebuilt graph warns from the true size", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [value] = createSignal(0);
    const build = () =>
      createRoot(d => {
        for (let i = 0; i < GRAPH_SIZE_WARN_AT; i++) {
          createEffect(
            () => value(),
            () => {}
          );
        }
        return d;
      });
    const dispose1 = build();
    flush();
    dispose1();
    flush();
    // If disposal failed to decrement, the second build's counts would pass
    // through 2500/3000/3500/4000 and emit interval warnings with counts
    // above the threshold; a correct rebuild warns exactly once, at the
    // threshold itself.
    const cap = captureGraphEvents();
    const dispose2 = build();
    flush();
    const events = cap.events();
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    cap.stop();
    dispose2();
    flush();
  });
});
