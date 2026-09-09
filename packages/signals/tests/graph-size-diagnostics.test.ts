import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";
import { GRAPH_SIZE_WARN_AT, GRAPH_SIZE_WARN_EVERY } from "../src/core/dev.js";

afterEach(() => {
  flush();
  vi.restoreAllMocks();
});

function captureGraphEvents() {
  const capture = OBSERVE!.diagnostics.capture();
  return {
    events: () => capture.events.filter(e => e.code === "HUGE_FAN_OUT" || e.code === "HUGE_FAN_IN"),
    stop: () => capture.stop()
  };
}

/** `n` effects subscribed to `read`, under one disposable root. */
function subscribe(read: () => unknown, n: number) {
  return createRoot(d => {
    for (let i = 0; i < n; i++) {
      createEffect(
        () => read(),
        () => {}
      );
    }
    return d;
  });
}

// The core keeps no live edge counts (a per-node counter was a
// post-construction field that forked node shapes): fan-out is counted by the
// notify walk a committed change already makes over its subscribers, fan-in
// by the recompute pass over the sources it tracks. So both warnings fire on
// the WORK — the write / the recompute — not on the link.
describe("graph-size diagnostics", () => {
  it("warns HUGE_FAN_OUT when a change reaches the subscriber threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const [value, setValue] = createSignal(0, { name: "hot-source" });
    const dispose = subscribe(value, GRAPH_SIZE_WARN_AT);
    flush();
    // Static structure alone is silent: nothing has re-run yet.
    expect(cap.events()).toHaveLength(0);
    setValue(1);
    flush();
    const events = cap.events();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("HUGE_FAN_OUT");
    expect(events[0].severity).toBe("warn");
    expect(events[0].nodeName).toBe("hot-source");
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[HUGE_FAN_OUT]"));
    expect(warn.mock.calls[0][0]).toContain(`with ${GRAPH_SIZE_WARN_AT} subscribers`);
    cap.stop();
    dispose();
    flush();
  });

  it("warns HUGE_FAN_IN when a recompute tracks the source threshold", () => {
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
    expect(events[0].nodeName).toBe("wide-reader");
    expect(events[0].data).toEqual({ count: GRAPH_SIZE_WARN_AT });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[HUGE_FAN_IN]"));
    cap.stop();
    dispose();
    flush();
  });

  it("counts distinct sources per pass — repeat reads and nested pulls do not inflate", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const signals = Array.from({ length: GRAPH_SIZE_WARN_AT - 1 }, (_, i) => createSignal(i));
    const [trigger, setTrigger] = createSignal(0);
    const dispose = createRoot(d => {
      createEffect(
        () => {
          trigger();
          // Each source read twice: 1999 distinct deps + trigger = 2000 - 1 + 1.
          for (const [read] of signals) (read(), read());
        },
        () => {}
      );
      return d;
    });
    flush();
    // Exactly the threshold — a double-counting pass would report ~4000.
    expect(cap.events().map(e => e.data)).toEqual([{ count: GRAPH_SIZE_WARN_AT }]);
    // A re-run tracks the same 2000: not grown by GRAPH_SIZE_WARN_EVERY, so silent.
    setTrigger(1);
    flush();
    expect(cap.events()).toHaveLength(1);
    cap.stop();
    dispose();
    flush();
  });

  it("re-warns once the count has grown by the repeat interval, not on every change", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const [value, setValue] = createSignal(0);
    const dispose1 = subscribe(value, GRAPH_SIZE_WARN_AT);
    setValue(1);
    flush();
    setValue(2);
    flush();
    // Two writes at the same size: one warning.
    expect(cap.events().map(e => e.data)).toEqual([{ count: GRAPH_SIZE_WARN_AT }]);
    // Grown, but by less than the interval: still one.
    const dispose2 = subscribe(value, GRAPH_SIZE_WARN_EVERY - 1);
    setValue(3);
    flush();
    expect(cap.events()).toHaveLength(1);
    // Reaches the interval: a second warning, at the new size.
    const dispose3 = subscribe(value, 1);
    setValue(4);
    flush();
    expect(cap.events().map(e => e.data)).toEqual([
      { count: GRAPH_SIZE_WARN_AT },
      { count: GRAPH_SIZE_WARN_AT + GRAPH_SIZE_WARN_EVERY }
    ]);
    cap.stop();
    dispose1();
    dispose2();
    dispose3();
    flush();
  });

  it("a rebuilt graph warns from its live size — unlinked subscribers are not counted", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [value, setValue] = createSignal(0);
    const dispose1 = subscribe(value, GRAPH_SIZE_WARN_AT);
    flush();
    dispose1();
    flush();
    const cap = captureGraphEvents();
    const dispose2 = subscribe(value, GRAPH_SIZE_WARN_AT);
    setValue(1);
    flush();
    // The count is the walked list, so a stale tally cannot read 4000 here.
    expect(cap.events().map(e => e.data)).toEqual([{ count: GRAPH_SIZE_WARN_AT }]);
    cap.stop();
    dispose2();
    flush();
  });

  it("a derived change counts its own fan-out", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cap = captureGraphEvents();
    const [value, setValue] = createSignal(0);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const doubled = createMemo(() => value() * 2, { name: "doubled" });
      subscribe(doubled, GRAPH_SIZE_WARN_AT);
    });
    flush();
    setValue(1);
    flush();
    const events = cap.events();
    expect(events.map(e => [e.code, e.nodeName])).toEqual([["HUGE_FAN_OUT", "doubled"]]);
    cap.stop();
    dispose();
    flush();
  });
});
