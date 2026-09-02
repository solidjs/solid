import { describe, expect, it, vi } from "vitest";
import { DEV } from "../src/index.js";
import { settlePendingSource } from "../src/core/async.js";
import { NOT_PENDING, STATUS_UNINITIALIZED } from "../src/core/constants.js";
import type { Computed } from "../src/core/core.js";

/**
 * The SETTLE_WALK_UNINITIALIZED_SOURCE tripwire has no reachable trigger
 * through the public API (both real call sites honor the contract), so these
 * tests drive `settlePendingSource` directly with minimal node shapes. The
 * walk itself no-ops on a node with no subscribers and no extended slot —
 * only the invariant at the top is under test.
 */
function fakeNode(overrides: Partial<Record<string, unknown>> = {}): Computed<any> {
  return {
    id: "test-node",
    _name: "fake",
    _statusFlags: STATUS_UNINITIALIZED,
    _pendingValue: NOT_PENDING,
    _x: null,
    _subs: null,
    ...overrides
  } as unknown as Computed<any>;
}

function captureCodes(run: () => void): string[] {
  // The error-severity diagnostic also prints via console.error; silence it
  // so the suite output stays clean.
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const capture = DEV!.diagnostics.capture();
  try {
    run();
    return capture.stop().map(event => event.code);
  } finally {
    error.mockRestore();
  }
}

describe("settlePendingSource uninitialized-source invariant", () => {
  it("fires for a settle with no truth to reveal (uninitialized, unheld, unerrored)", () => {
    const codes = captureCodes(() => settlePendingSource(fakeNode()));
    expect(codes).toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
  });

  it("fires when self is the only pending source", () => {
    const source = fakeNode({ _x: { _error: null, _pendingSources: new Set() } });
    source._x!._pendingSources = new Set([source]);
    const codes = captureCodes(() => settlePendingSource(source));
    expect(codes).toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
  });

  it("stays silent when self ownership transfers to a replacement source", () => {
    const source = fakeNode({ _x: { _error: null, _pendingSources: new Set() } });
    const replacement = fakeNode({ _statusFlags: 0 });
    source._x!._pendingSources = new Set([source, replacement]);
    const codes = captureCodes(() => settlePendingSource(source));
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
  });

  it("stays silent for a transition-held first landing (truth parked in _pendingValue)", () => {
    // Streamed hydration's shape: the first landing committed into a held
    // pending value, so the flag is still set but truth exists.
    const codes = captureCodes(() => settlePendingSource(fakeNode({ _pendingValue: "held" })));
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
  });

  it("stays silent for an errored first landing (the error is the truth)", () => {
    const codes = captureCodes(() =>
      settlePendingSource(fakeNode({ _x: { _error: new Error("landing failed") } }))
    );
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
  });

  it("stays silent for an initialized source", () => {
    const codes = captureCodes(() => settlePendingSource(fakeNode({ _statusFlags: 0 })));
    expect(codes).not.toContain("SETTLE_WALK_UNINITIALIZED_SOURCE");
  });
});
