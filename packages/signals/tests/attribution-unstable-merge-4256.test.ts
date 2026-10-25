import { afterEach, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import { createEffect, createRoot, createSignal, flush, merge, OBSERVE } from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function captureUnstable() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, unstableMemos: 4 });
  const events: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "UNSTABLE_MEMO_OUTPUT") events.push(e);
  });
  return events;
}

// #4256: a compiled conditional component spread (`<Child {...(on() ? { tone } : {})} />`)
// is `merge(() => …)`. The memo merge() wraps the function in returns a fresh
// key bag each run, and no user can pass it `equals`.
it("merge()'s function-source memo is not reported as unstable output (#4256)", () => {
  const [n, setN] = createSignal(0, { name: "n" });
  let seen: unknown;
  createRoot(() => {
    const props = merge(() => (n() >= 0 ? { tone: "info" } : {})) as { tone?: string };
    createEffect(
      () => props.tone,
      v => {
        seen = v;
      },
      { name: "reader" }
    );
  });
  flush();

  const events = captureUnstable();
  for (let i = 1; i <= 8; i++) {
    setN(i);
    flush();
  }

  expect(seen).toBe("info");
  expect(events).toHaveLength(0);
});
