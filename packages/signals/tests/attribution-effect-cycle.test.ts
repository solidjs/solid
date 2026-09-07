/**
 * EFFECT_WRITES_OWN_SOURCE: an effect whose write feeds back into its own
 * inputs — converging, so the flush guard never fires — is reported the first
 * time the re-run's cause chain resolves back to the effect itself, across
 * however many memos, and across other effects that relay the write.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  DEV,
  flush,
  untrack
} from "../src/index.js";
import type { RerunEvent } from "../src/core/attribution.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  const cycles: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => {
    if (e.code === "EFFECT_WRITES_OWN_SOURCE") cycles.push(e);
  });
  return cycles;
}

describe("EFFECT_WRITES_OWN_SOURCE", () => {
  it("reports an effect that clamps a signal it reads (converging, not looping)", () => {
    const cycles = arm();
    const [page, setPage] = createSignal(1, { name: "page" });
    const [max] = createSignal(10, { name: "max" });
    createRoot(() =>
      createEffect(
        () => ({ page: page(), max: max() }),
        v => {
          if (v.page > v.max) setPage(v.max);
        },
        { name: "clampPage" }
      )
    );
    flush();
    expect(cycles).toEqual([]);

    setPage(12);
    flush();
    expect(page()).toBe(10);
    expect(cycles).toHaveLength(1);
    const [entry] = cycles;
    expect(entry.severity).toBe("warn");
    expect(entry.kind).toBe("perf");
    expect(entry.nodeName).toBe("clampPage");
    expect(entry.message).toContain('effect "clampPage" re-ran because of its own write');
    expect(entry.message).toContain('wrote "page" (12 → 10)');
    expect(entry.message).toContain("compute it in a memo");
    expect(entry.data).toEqual({
      effects: ["clampPage"],
      writes: [{ effect: "clampPage", kind: "write", name: "page", prev: "12", value: "10" }],
      flushes: 2
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("does not report an effect that writes a signal it does not read", () => {
    const cycles = arm();
    const [query, setQuery] = createSignal("", { name: "query" });
    const [, setPage] = createSignal(1, { name: "page" });
    createRoot(() =>
      createEffect(
        query,
        () => {
          setPage(1);
        },
        { name: "resetPage" }
      )
    );
    flush();
    setQuery("a");
    flush();
    setQuery("b");
    flush();
    expect(cycles).toEqual([]);
  });

  it("does not report a re-run caused from outside the effect", () => {
    const cycles = arm();
    const [n, setN] = createSignal(0, { name: "n" });
    const [, setOther] = createSignal(0, { name: "other" });
    createRoot(() =>
      createEffect(
        n,
        v => {
          setOther(v * 2);
        },
        { name: "mirror" }
      )
    );
    flush();
    for (let i = 1; i < 5; i++) {
      setN(i);
      flush();
    }
    expect(cycles).toEqual([]);
  });

  it("follows the write through memos to the effect's inputs", () => {
    const cycles = arm();
    const [page, setPage] = createSignal(1, { name: "page" });
    const range = createMemo(() => ({ start: page() * 10, end: page() * 10 + 10 }), {
      name: "pageRange"
    });
    const rows = createMemo(() => `${range().start}-${range().end}`, { name: "visibleRows" });
    createRoot(() =>
      createEffect(
        rows,
        () => {
          if (page() > 5) setPage(5);
        },
        { name: "clampRows" }
      )
    );
    flush();
    setPage(9);
    flush();
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toContain(
      'fed back into its inputs through memo "pageRange" → memo "visibleRows"'
    );
  });

  it("reports a write cycle relayed across two effects, as advisory", () => {
    const cycles = arm();
    const [raw, setRaw] = createSignal("", { name: "raw" });
    const [trimmed, setTrimmed] = createSignal("", { name: "trimmed" });
    createRoot(() => {
      // normalize: raw → trimmed; writeBack: trimmed → raw. Converges once raw
      // is already trimmed — three flushes for one keystroke.
      createEffect(
        raw,
        v => {
          setTrimmed(v.trim());
        },
        { name: "normalize" }
      );
      createEffect(
        trimmed,
        v => {
          if (untrack(raw) !== v) setRaw(v);
        },
        { name: "writeBack" }
      );
    });
    flush();
    setRaw(" a ");
    flush();
    expect(raw()).toBe("a");
    expect(trimmed()).toBe("a");
    expect(cycles).toHaveLength(1);
    const [entry] = cycles;
    expect(entry.severity).toBe("info");
    expect(entry.nodeName).toBe("normalize");
    expect(entry.data!.effects).toEqual(["normalize", "writeBack"]);
    expect(entry.message).toContain(
      'effects "normalize" → "writeBack" → "normalize" relay writes in a cycle: ' +
        'effect "normalize" wrote "trimmed" ("" → "a"); effect "writeBack" re-ran and wrote ' +
        '"raw" (" a " → "a"); which fed back into effect "normalize"\'s inputs — 3 flushes to settle'
    );
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it("reports each cycle once", () => {
    const cycles = arm();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() =>
      createEffect(
        n,
        v => {
          if (v % 2) setN(v + 1);
        },
        { name: "evenOnly" }
      )
    );
    flush();
    for (const v of [1, 3, 5]) {
      setN(v);
      flush();
    }
    expect(n()).toBe(6);
    expect(cycles).toHaveLength(1);
  });

  it("catches a write from the effect's create run feeding back", () => {
    const cycles = arm();
    const [n, setN] = createSignal(-1, { name: "n" });
    createRoot(() =>
      createEffect(
        n,
        v => {
          if (v < 0) setN(0);
        },
        { name: "floor" }
      )
    );
    flush();
    expect(n()).toBe(0);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toContain('wrote "n" (-1 → 0)');
  });

  it("stamps effect-origin writes with the run whose effect phase made them", () => {
    arm();
    const runs: RerunEvent[] = [];
    DEV!.attribution.subscribe(e => runs.push(e));
    const [n, setN] = createSignal(0, { name: "n" });
    const [out, setOut] = createSignal(0, { name: "out" });
    createRoot(() => {
      createEffect(
        n,
        v => {
          setOut(v);
        },
        { name: "writer" }
      );
      createEffect(out, () => {}, { name: "reader" });
    });
    flush();
    setN(1);
    flush();
    const writerRun = runs.find(r => r.nodeName === "writer")!;
    const readerRun = runs.find(r => r.nodeName === "reader")!;
    expect(readerRun.causes[0].origin).toEqual({
      kind: "effect",
      name: "writer",
      run: writerRun.run
    });
  });
});
