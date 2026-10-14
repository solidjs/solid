import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  OBSERVE
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";
import { GRAPH_SIZE_WARN_AT } from "../src/core/dev.js";

// #3739: WIDE_SCOPE_DEPS judges what the scope's author can act on. HMR
// plumbing is not a source, the renderer's child-resolution pass (`_wide`)
// is not judged, and the default threshold is calibrated for user-written
// scopes; HUGE_FAN_IN keeps no exceptions.

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function capture(codes: string[]) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const events: DiagnosticEvent[] = [];
  const off = OBSERVE!.diagnostics.subscribe(e => {
    if (codes.includes(e.code)) events.push(e);
  });
  disposers.push(off);
  return events;
}

function root<T>(fn: () => T): T {
  return createRoot(dispose => {
    disposers.push(dispose);
    return fn();
  });
}

/** thedanchez's list fan-in: a memo combining a keyed list's per-row memos. */
function sumOfRowMemos(n: number) {
  const [rows] = createStore(Array.from({ length: n }, (_, i) => ({ id: `r${i}`, price: i })));
  const perRow = mapArray(
    () => rows,
    row => createMemo(() => row().price * 2),
    { keyed: (r: { id: string }) => r.id }
  );
  return createMemo(() => perRow().reduce((s, rowTotal) => s + rowTotal(), 0), {
    name: `sum of ${n}`
  });
}

describe("WIDE_SCOPE_DEPS default threshold", () => {
  it("is quiet for a memo over 40 per-row memos at the default", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false });
    const total = root(() => sumOfRowMemos(40));
    flush();
    expect(total()).toBe(1560);
    expect(events).toEqual([]);
  });

  it("is quiet for a memo over 150 per-row memos, under the default of 200", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false });
    const total = root(() => sumOfRowMemos(150));
    flush();
    total();
    expect(events).toEqual([]);
  });

  it("warns for a memo over 250 per-row memos at the default", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false });
    const total = root(() => sumOfRowMemos(250));
    flush();
    total();
    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("sum of 250");
    expect(events[0].data!.depCount).toBe(251); // the row list + 250 row memos
  });

  it("warns for a memo over 600 per-row memos at the default", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false });
    const total = root(() => sumOfRowMemos(600));
    flush();
    total();
    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("sum of 600");
    expect(events[0].data!.depCount).toBe(601); // the row list + 600 row memos
  });
});

describe("HMR plumbing is not a source", () => {
  it("does not count `_plumbing` memos toward a scope's width", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 30 });
    const read = root(() => {
      const wrappers = Array.from({ length: 40 }, (_, i) =>
        createMemo(() => i, { _plumbing: true, transparent: true })
      );
      return createMemo(() => wrappers.map(w => w()), { name: "rows" });
    });
    flush();
    expect(read()).toHaveLength(40);
    expect(events).toEqual([]);
  });

  it("counts the real sources beside plumbing, and names only them", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 4 });
    root(() => {
      const wrappers = Array.from({ length: 10 }, (_, i) =>
        createMemo(() => i, { _plumbing: true, transparent: true })
      );
      const real = Array.from({ length: 5 }, (_, i) => createSignal(i, { name: `s${i}` })[0]);
      return createMemo(
        () => wrappers.reduce((s, w) => s + w(), 0) + real.reduce((s, r) => s + r(), 0),
        { name: "mixed" }
      )();
    });
    expect(events).toHaveLength(1);
    expect(events[0].data!.depCount).toBe(5);
    expect(events[0].data!.deps).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });
});

describe("`_wide` framework scopes", () => {
  function wideEffect(n: number, wide: boolean) {
    const signals = Array.from({ length: n }, (_, i) => createSignal(i)[0]);
    createRenderEffect(
      () => signals.reduce((s, sig) => s + sig(), 0),
      () => {},
      { name: "resolve", ...(wide ? { _wide: true } : {}) } as any
    );
  }

  it("are not judged by WIDE_SCOPE_DEPS", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 30 });
    root(() => wideEffect(40, true));
    flush();
    expect(events).toEqual([]);
  });

  it("an unmarked effect of the same shape still is (control)", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false, wideDeps: 30 });
    root(() => wideEffect(40, false));
    flush();
    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("resolve");
  });

  it("still fire HUGE_FAN_IN past GRAPH_SIZE_WARN_AT", () => {
    const events = capture(["HUGE_FAN_IN", "WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, hotTime: false });
    root(() => wideEffect(GRAPH_SIZE_WARN_AT + 1, true));
    flush();
    expect(events.map(e => e.code)).toEqual(["HUGE_FAN_IN"]);
  });
});

describe("engine-side HUGE_FAN_OUT and HMR plumbing", () => {
  it("does not count plumbing subscribers toward `fanOut`", () => {
    const events = capture(["HUGE_FAN_OUT"]);
    const [registration, setRegistration] = createSignal(0, { name: "registration" });
    root(() => {
      for (let i = 0; i < 30; i++)
        createMemo(() => registration(), { _plumbing: true, transparent: true })();
    });
    flush();
    attribution.enable({ log: false, hotRuns: false, hotTime: false, fanOut: 25 });
    setRegistration(1);
    flush();
    expect(events).toEqual([]);
  });

  it("counts the non-plumbing subscribers beside them", () => {
    const events = capture(["HUGE_FAN_OUT"]);
    const [selected, setSelected] = createSignal(0, { name: "selected" });
    root(() => {
      for (let i = 0; i < 30; i++)
        createMemo(() => selected(), { _plumbing: true, transparent: true })();
      for (let i = 0; i < 26; i++)
        createRenderEffect(
          () => selected(),
          () => {}
        );
    });
    flush();
    attribution.enable({ log: false, hotRuns: false, hotTime: false, fanOut: 25 });
    setSelected(1);
    flush();
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ count: 26, write: "write" });
  });
});

describe("checks across holds", () => {
  it("a records-only hold leaves the cost checks off", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, checks: false, wideDeps: 4 });
    root(() => {
      const s = Array.from({ length: 5 }, (_, i) => createSignal(i)[0]);
      return createMemo(() => s.reduce((a, r) => a + r(), 0))();
    });
    expect(events).toEqual([]);
  });

  it("another hold asking for checks turns them on beside it", () => {
    const events = capture(["WIDE_SCOPE_DEPS"]);
    attribution.enable({ log: false, checks: false });
    attribution.enable({ log: false, hotTime: false, wideDeps: 4 });
    root(() => {
      const s = Array.from({ length: 5 }, (_, i) => createSignal(i)[0]);
      return createMemo(() => s.reduce((a, r) => a + r(), 0), { name: "five" })();
    });
    expect(events).toHaveLength(1);
    expect(events[0].nodeName).toBe("five");
  });
});
