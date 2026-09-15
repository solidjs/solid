/** @vitest-environment node */
/**
 * `OBSERVE.server` — the server runtime's observe surface, as solid-js's
 * server entry owns it: the trace-provider slot.
 *
 * Claims under test (Sentry spike SHAPE-NOTES J.23/J.24): the slot exists the
 * moment `solid-js` loads on the server — an observer's `init()` that imports
 * only `solid-js` can install a provider before any web entry evaluates — and
 * it is one per PROCESS, under a registered symbol on `globalThis`, so a
 * second copy of the runtime (a bundled server build instrumented through a
 * `--import`ed module) finds the same provider. The container is generic:
 * solid-js knows nothing of the provider's shape; that is the emitting
 * runtime's (`@solidjs/web`), which reads it by the same registered name.
 *
 * Records are NOT here: they ride the core's `OBSERVE.records` on both
 * platforms (see @solidjs/signals observe-records.test.ts); solid-js only
 * declares its `"boundary"` record onto it (server-boundary-records.spec.tsx).
 */
import { describe, expect, it } from "vitest";
import { OBSERVE as CORE } from "@solidjs/signals";
import { OBSERVE } from "../../src/server/index.js";

const SLOTS = Symbol.for("solid-js/observe/server");
const PROVIDER = Symbol.for("solid-js/observe/server/provider");

type Slots = {
  trace: { [PROVIDER]?: Function; provide(provider: Function): () => void };
};

describe("OBSERVE.server", () => {
  const server = OBSERVE!.server as unknown as Slots;

  it("is populated by solid-js's server entry, before any web runtime loads", () => {
    expect(typeof server.trace.provide).toBe("function");
    // Installed onto the core's own OBSERVE object, which is what solid-js
    // re-exports: one object, whichever import a consumer reads it through.
    expect(CORE!.server).toBe(server);
    // The trace slot is the whole surface; the records channel is the core's.
    expect(Object.keys(server)).toEqual(["trace"]);
    expect(CORE!.records).toBe(OBSERVE!.records);
  });

  it("is one object per process, registered on globalThis for every runtime copy", () => {
    expect((globalThis as any)[SLOTS]).toBe(server);
  });

  it("provide: a single replaceable provider; the disposer only clears its own", () => {
    const a = () => "a";
    const b = () => "b";
    const offA = server.trace.provide(a);
    expect(server.trace[PROVIDER]).toBe(a);
    const offB = server.trace.provide(b);
    expect(server.trace[PROVIDER]).toBe(b);
    // A stale disposer does not evict its successor.
    offA();
    expect(server.trace[PROVIDER]).toBe(b);
    offB();
    expect(server.trace[PROVIDER]).toBeUndefined();
  });
});
