import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, createMemo, createRoot, createSignal, DEV, flush } from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

/** Enable quietly and capture UNSTABLE_MEMO_OUTPUT diagnostics. */
function captureUnstable(unstableMemos: number | false = 4) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false, unstableMemos });
  const events: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => {
    if (e.code === "UNSTABLE_MEMO_OUTPUT") events.push(e);
  });
  return events;
}

describe("UNSTABLE_MEMO_OUTPUT", () => {
  it("warns when a memo produces new-but-equivalent objects on consecutive runs", () => {
    const [n, setN] = createSignal(1, { name: "n" });
    const view = createMemo(
      // Fresh object every run, content never actually varies:
      () => ({ positive: n() > 0, label: "user" }),
      { name: "view" }
    );
    createRoot(() =>
      createEffect(
        () => view(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    const events = captureUnstable();
    for (let i = 2; i <= 8; i++) {
      setN(i);
      flush();
    }

    expect(events).toHaveLength(1); // warned once at the threshold, then muted
    expect(events[0].nodeName).toBe("view");
    expect(events[0].data).toMatchObject({ runs: 4, shape: "object" });
    expect(events[0].message).toContain("equality gate never closes");
    expect(events[0].message).toContain("`equals` option");
  });

  it("warns for equivalent fresh arrays", () => {
    const [n, setN] = createSignal(1, { name: "n" });
    const list = createMemo(() => ["a", "b", n() > 0], { name: "list" });
    createRoot(() =>
      createEffect(
        () => list(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    const events = captureUnstable();
    for (let i = 2; i <= 6; i++) {
      setN(i);
      flush();
    }

    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ shape: "array" });
  });

  it("resets the streak when the output genuinely changes", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    // Content changes every third run — streak never reaches the threshold.
    const view = createMemo(() => ({ bucket: Math.floor(n() / 3) }), { name: "resetting" });
    createRoot(() =>
      createEffect(
        () => view(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    const events = captureUnstable(3);
    for (let i = 1; i <= 12; i++) {
      setN(i);
      flush();
    }

    expect(events).toHaveLength(0);
  });

  it("stays quiet for stable references, primitives, and non-plain shapes", () => {
    const [n, setN] = createSignal(1, { name: "n" });
    const stable = { fixed: true };
    createRoot(() => {
      const a = createMemo(() => (n(), stable), { name: "stable-ref" });
      const b = createMemo(() => n() % 2, { name: "primitive" });
      const c = createMemo(() => (n(), new Date(0)), { name: "date" });
      createEffect(
        () => (a(), b(), c()),
        () => {},
        { name: "consumer" }
      );
    });
    flush();

    const events = captureUnstable();
    for (let i = 2; i <= 10; i++) {
      setN(i);
      flush();
    }

    expect(events).toHaveLength(0);
  });

  it("can be disabled", () => {
    const [n, setN] = createSignal(1, { name: "n" });
    const view = createMemo(() => ({ on: n() > 0 }), { name: "view" });
    createRoot(() =>
      createEffect(
        () => view(),
        () => {},
        { name: "consumer" }
      )
    );
    flush();

    const events = captureUnstable(false);
    for (let i = 2; i <= 10; i++) {
      setN(i);
      flush();
    }

    expect(events).toHaveLength(0);
  });
});
