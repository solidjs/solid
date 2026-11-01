/**
 * Reader-seat shadow reporter (S0, documentation/plans/reader-seat-rebuild.md
 * §3–§4). Loaded as a vitest setup file when `SEAT_SHADOW_REPORT=<file>` is
 * set: after each test file, the shadow's record (`globalThis.__SEAT_SHADOW__`,
 * installed by `src/core/seat.ts` under `__TEST__`) is appended to the file
 * as one JSON line and reset. `scripts/seat-shadow-summary.mjs` aggregates.
 *
 * `SEAT_SHADOW_STRICT=1` makes the shadow throw at the first disagreement
 * instead (the failing test names the row).
 */
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect } from "vitest";

const file = process.env.SEAT_SHADOW_REPORT;
if (process.env.SEAT_SHADOW_STRICT) (globalThis as any).__SEAT_SHADOW_STRICT__ = true;
if (process.env.SEAT_SHADOW_TRACE)
  (globalThis as any).__SEAT_SHADOW_TRACE__ = process.env.SEAT_SHADOW_TRACE;

beforeAll(() => {
  (globalThis as any).__SEAT_SHADOW__?.reset();
});

// The test a disagreement is first seen in (the record's `case`).
beforeEach(ctx => {
  (globalThis as any).__SEAT_SHADOW_CASE__ = ctx.task.name;
});

afterAll(() => {
  const shadow = (globalThis as any).__SEAT_SHADOW__;
  if (!file || !shadow) return;
  const report = shadow.report();
  appendFileSync(file, JSON.stringify({ file: expect.getState().testPath, ...report }) + "\n");
  shadow.reset();
});
