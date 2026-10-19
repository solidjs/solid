/**
 * EFFECT_RELAY_TEAR: derived state kept in sync by an effect makes every
 * scope that reads both the source and the relayed value run twice for one
 * write — the first frame inconsistent. Proven from the cause chain (the
 * victim's re-run has only effect-origin roots, and the relaying run shares a
 * root write with the victim's previous run); identity-copy and sole-writer
 * are message modifiers, and a repeated identity copy warns on its own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  OBSERVE,
  untrack
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  const tears: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "EFFECT_RELAY_TEAR") tears.push(e);
  });
  return tears;
}

/** query → (effect) → filtered; `row` reads both. */
function relayFixture(
  compute: (q: string) => string = q => q.toUpperCase(),
  write: (v: string) => string = v => v
) {
  const [query, setQuery] = createSignal("", { name: "query" });
  const [filtered, setFiltered] = createSignal("", { name: "filtered" });
  const rowRuns: string[] = [];
  createRoot(() => {
    createEffect(
      () => compute(query()),
      v => {
        setFiltered(write(v));
      },
      { name: "syncFiltered" }
    );
    createEffect(
      () => `${query()}/${filtered()}`,
      v => {
        rowRuns.push(v);
      },
      { name: "row" }
    );
  });
  flush();
  return { setQuery, setFiltered, rowRuns };
}

describe("EFFECT_RELAY_TEAR", () => {
  it("reports a reader that ran twice for one write; a written compute output warns as derivable", () => {
    const tears = arm();
    const { setQuery, rowRuns } = relayFixture();
    rowRuns.length = 0;
    setQuery("a");
    flush();
    // The tear itself: one write, two runs, the first against stale state.
    expect(rowRuns).toEqual(["a/", "a/A"]);
    expect(tears).toHaveLength(1);
    const [entry] = tears;
    expect(entry.severity).toBe("warn");
    expect(entry.kind).toBe("perf");
    expect(entry.nodeName).toBe("row");
    expect(entry.message).toContain('effect "row" ran twice for one write of "query"');
    expect(entry.message).toContain('effect "syncFiltered" relayed it by writing "filtered"');
    expect(entry.message).toContain(
      'by contract a pure function of what it tracks: make "filtered" a memo'
    );
    expect(entry.data).toEqual({
      victim: "row",
      root: "query",
      relay: "syncFiltered",
      wrote: "filtered",
      copy: true,
      passthrough: null,
      soleWriter: true,
      occurrences: 1
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
    // One verdict per relayed signal.
    setQuery("b");
    flush();
    expect(tears).toHaveLength(1);
  });

  it("names the source when the relayed value is the source itself", () => {
    const tears = arm();
    const { setQuery } = relayFixture(q => q);
    setQuery("a");
    flush();
    expect(tears).toHaveLength(1);
    expect(tears[0].severity).toBe("warn");
    expect(tears[0].data!.passthrough).toBe("query");
    expect(tears[0].message).toContain(
      'The written value is "query" itself: read "query" where "filtered" is read'
    );
  });

  it("is advisory for a non-derivable write, escalating once the relay has torn repeatedly", () => {
    const tears = arm();
    const { setQuery } = relayFixture(
      q => q,
      v => v + "!"
    );
    setQuery("a");
    flush();
    expect(tears).toHaveLength(1);
    expect(tears[0].severity).toBe("info");
    expect(tears[0].data!.copy).toBe(false);
    expect(tears[0].message).toContain(
      'Nothing else writes "filtered". If "filtered" is computed from what the effect reads'
    );
    expect(console.warn).not.toHaveBeenCalled();
    for (const q of ["b", "c", "d", "e"]) {
      setQuery(q);
      flush();
    }
    expect(tears.map(t => t.severity)).toEqual(["info", "warn"]);
    expect(tears[1].message).toContain("(3 times so far)");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("treats a copy into a signal with other writers as a reset, advisory", () => {
    const tears = arm();
    const { setQuery, setFiltered } = relayFixture(q => q);
    setFiltered("typed");
    flush();
    setQuery("a");
    flush();
    expect(tears).toHaveLength(1);
    expect(tears[0].severity).toBe("info");
    expect(tears[0].data).toMatchObject({ copy: true, soleWriter: false });
    expect(tears[0].message).toContain("editable state reset from a source");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("offers the measurement fork when the relayed signal has other writers", () => {
    const tears = arm();
    const { setQuery, setFiltered } = relayFixture(
      q => q,
      v => v + "!"
    );
    setFiltered("manual");
    flush();
    setQuery("a");
    flush();
    expect(tears).toHaveLength(1);
    expect(tears[0].data!.soleWriter).toBe(false);
    expect(tears[0].message).toContain("the tear is the cost of measuring");
  });

  it("does not report a re-run that has an independent outside cause", () => {
    const tears = arm();
    const [a, setA] = createSignal(0, { name: "a" });
    const [b, setB] = createSignal(0, { name: "b" });
    const [c, setC] = createSignal(0, { name: "c" });
    createRoot(() => {
      createEffect(
        a,
        v => {
          setB(v * 2);
        },
        { name: "double" }
      );
      // Reads b and c, never a: its re-run after `double` writes is not a
      // second run for the same root, because it did not run for `a`.
      createEffect(
        () => b() + c(),
        () => {},
        { name: "sum" }
      );
    });
    flush();
    setA(1);
    flush();
    setC(1);
    flush();
    expect(tears).toEqual([]);
  });

  it("does not report a memo-derived value (the correct shape)", () => {
    const tears = arm();
    const [query, setQuery] = createSignal("", { name: "query" });
    const filtered = createMemo(() => query().toUpperCase(), { name: "filtered" });
    createRoot(() =>
      createEffect(
        () => `${query()}/${filtered()}`,
        () => {},
        { name: "row" }
      )
    );
    flush();
    setQuery("a");
    flush();
    expect(tears).toEqual([]);
  });

  it("warns on a repeated identity copy even with no reader of both", () => {
    const tears = arm();
    const [source, setSource] = createSignal(0, { name: "source" });
    const [local, setLocal] = createSignal(0, { name: "local" });
    createRoot(() => {
      createEffect(
        source,
        v => {
          setLocal(v);
        },
        { name: "syncLocal" }
      );
      createEffect(local, () => {}, { name: "reader" });
    });
    flush();
    setSource(1);
    flush();
    // One copy proves nothing; the second makes it the effect's job.
    expect(tears).toEqual([]);
    setSource(2);
    flush();
    expect(tears).toHaveLength(1);
    const [entry] = tears;
    expect(entry.severity).toBe("warn");
    expect(entry.nodeName).toBe("syncLocal");
    expect(entry.message).toContain(
      'effect "syncLocal" writes its compute output into "local" on every run'
    );
    expect(entry.message).toContain('The written value is "source" itself');
    expect(entry.data).toEqual({
      relay: "syncLocal",
      wrote: "local",
      copy: true,
      passthrough: "source",
      soleWriter: true
    });
    setSource(3);
    flush();
    expect(tears).toHaveLength(1);
  });

  it("does not call a transformed write a copy", () => {
    const tears = arm();
    const [source, setSource] = createSignal(0, { name: "source" });
    const [, setLocal] = createSignal(0, { name: "local" });
    createRoot(() =>
      createEffect(
        source,
        v => {
          setLocal(v * 2);
        },
        { name: "scale" }
      )
    );
    flush();
    setSource(1);
    flush();
    setSource(2);
    flush();
    expect(tears).toEqual([]);
  });
  it("stays advisory for a layout measurement keyed on a boolean (no copy, no escalation)", () => {
    const tears = arm();
    const [open, setOpen] = createSignal(false, { name: "open" });
    const [fallback, setFallback] = createSignal(false, { name: "alignFallback" });
    // Near the screen edge: the measurement agrees with `open` every time.
    const measure = () => untrack(open);
    createRoot(() => {
      createEffect(
        open,
        () => {
          setFallback(measure());
        },
        { name: "measureFallback" }
      );
      createEffect(
        () => (open() ? (fallback() ? "fallback" : "aligned") : "closed"),
        () => {},
        { name: "position" }
      );
    });
    flush();
    for (let i = 0; i < 5; i++) {
      setOpen(true);
      flush();
      setOpen(false);
      flush();
    }
    expect(tears.map(t => t.severity)).toEqual(["info"]);
    expect(tears[0].data).toMatchObject({ copy: false, soleWriter: true });
    expect(tears[0].message).toContain("the tear is the cost of measuring");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("never escalates a relay whose same input wrote different values", () => {
    const tears = arm();
    const [query, setQuery] = createSignal("", { name: "query" });
    const [width, setWidth] = createSignal(0, { name: "width" });
    let layout = 0;
    createRoot(() => {
      createEffect(
        query,
        () => {
          setWidth(++layout);
        },
        { name: "measureWidth" }
      );
      createEffect(
        () => `${query()}/${width()}`,
        () => {},
        { name: "row" }
      );
    });
    flush();
    for (const q of ["a", "b", "a", "c", "d", "e"]) {
      setQuery(q);
      flush();
    }
    expect(tears.map(t => t.severity)).toEqual(["info"]);
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("still flags a boolean mirror and a boolean-keyed derivation (the apply half takes its value)", () => {
    const tears = arm();
    const [open, setOpen] = createSignal(false, { name: "open" });
    const [mirror, setMirror] = createSignal(false, { name: "mirror" });
    const [label, setLabel] = createSignal("Open", { name: "label" });
    createRoot(() => {
      createEffect(
        open,
        v => {
          setMirror(v);
        },
        { name: "syncMirror" }
      );
      createEffect(
        open,
        v => {
          setLabel(v ? "Close" : "Open");
        },
        { name: "syncLabel" }
      );
      createEffect(
        () => `${open()}/${mirror()}`,
        () => {},
        { name: "mirrorRow" }
      );
      createEffect(
        () => `${open()}/${label()}`,
        () => {},
        { name: "labelRow" }
      );
    });
    flush();
    for (let i = 0; i < 3; i++) {
      setOpen(true);
      flush();
      setOpen(false);
      flush();
    }
    const warned = tears.filter(t => t.severity === "warn").map(t => t.data!.wrote);
    expect(warned).toContain("mirror");
    expect(warned).toContain("label");
  });
});
