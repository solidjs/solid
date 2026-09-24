/**
 * `OBSERVE.records` — the one channel every runtime record rides, on either
 * platform: the attribution engine's `"rerun"`, `"hold"`, `"interaction"` and
 * the rest of its timeline, solid-js's `"boundary"`, @solidjs/web's
 * `"invocation"`, `"frame"` and `"call"`. The core owns the container and
 * knows no record type beyond declaring the engine's; the runtimes declare
 * theirs onto it (type-level, `RecordTypes` / `HostRecordTypes`) and emit
 * through it.
 *
 * Claims under test:
 *  - one per PROCESS, registered on `globalThis`: a second copy of the core
 *    (a bundled build instrumented through a `--import`ed module, a wire
 *    layer that must not import the framework) reaches the same listener
 *    sets by the registered name;
 *  - `observed(type)` is the emitter's cheap pre-check — no listener, no
 *    record built, not even a clock read;
 *  - a listener cannot alter the emit: it is snapshotted per emit, a
 *    throwing listener is reported and the rest still run.
 *
 * The emit allocates nothing: the listener list is copied on subscribe and
 * unsubscribe, never on delivery, so the loop walks the array it started
 * with; one try/catch around it resumes past a throwing listener.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OBSERVE } from "../src/index.js";

const RECORDS = Symbol.for("@solidjs/signals/observe/records");
const records = OBSERVE!.records as unknown as {
  subscribe(type: string, listener: Function): () => void;
  observed(type: string): boolean;
  emit(type: string, event: unknown, live: unknown): void;
};
const disposers: Array<() => void> = [];
const on = (type: string, listener: Function) => {
  const off = records.subscribe(type, listener);
  disposers.push(off);
  return off;
};

afterEach(() => {
  for (const off of disposers.splice(0)) off();
  vi.restoreAllMocks();
});

describe("OBSERVE.records", () => {
  it("is one object per process, registered on globalThis under its name", () => {
    expect((globalThis as any)[RECORDS]).toBe(records);
    expect(typeof records.subscribe).toBe("function");
  });

  it("observed: false with no listener for the type; true while one is subscribed", () => {
    expect(records.observed("probe")).toBe(false);
    const off = on("probe", () => {});
    expect(records.observed("probe")).toBe(true);
    // A listener for another type is not this type's.
    expect(records.observed("other")).toBe(false);
    off();
    expect(records.observed("probe")).toBe(false);
  });

  it("emit: delivers the event and the live handles to every listener of the type, in order", () => {
    const seen: unknown[] = [];
    on("probe", (event: unknown, live: unknown) => seen.push(["a", event, live]));
    on("probe", (event: unknown, live: unknown) => seen.push(["b", event, live]));
    on("other", () => seen.push("other"));
    const live = { handle: true };
    records.emit("probe", { id: "x" }, live);
    expect(seen).toEqual([
      ["a", { id: "x" }, live],
      ["b", { id: "x" }, live]
    ]);
    // Unobserved: a no-op rather than an error, for an emitter that skipped
    // the pre-check.
    expect(() => records.emit("nobody", {}, {})).not.toThrow();
  });

  it("a throwing listener is reported and does not stop the others", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    on("probe", () => {
      throw new Error("listener broke");
    });
    on("probe", () => seen.push("after"));
    records.emit("probe", {}, {});
    expect(seen).toEqual(["after"]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("listener broke");
  });

  it("every throwing listener is reported and delivery resumes after each", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    on("probe", () => {
      throw new Error("first");
    });
    on("probe", () => seen.push("between"));
    on("probe", () => {
      throw new Error("second");
    });
    on("probe", () => seen.push("after"));
    records.emit("probe", {}, {});
    expect(seen).toEqual(["between", "after"]);
    expect(error.mock.calls.map(c => String(c[0]))).toEqual([
      expect.stringContaining("first"),
      expect.stringContaining("second")
    ]);
  });

  it("the same listener subscribed twice is one subscription", () => {
    const seen: string[] = [];
    const listener = () => seen.push("a");
    const off1 = on("probe", listener);
    on("probe", listener);
    records.emit("probe", {}, {});
    expect(seen).toEqual(["a"]);
    off1();
    expect(records.observed("probe")).toBe(false);
  });

  it("the listener set is snapshotted per emit: subscribing or unsubscribing inside does not affect this delivery", () => {
    const seen: string[] = [];
    let offB: () => void = () => {};
    on("probe", () => {
      seen.push("a");
      offB();
      on("probe", () => seen.push("c"));
    });
    offB = on("probe", () => seen.push("b"));
    records.emit("probe", {}, {});
    expect(seen).toEqual(["a", "b"]);
    records.emit("probe", {}, {});
    expect(seen).toEqual(["a", "b", "a", "c"]);
  });

  it("unsubscribe is idempotent and only removes its own listener", () => {
    const seen: string[] = [];
    const offA = on("probe", () => seen.push("a"));
    on("probe", () => seen.push("b"));
    offA();
    offA();
    records.emit("probe", {}, {});
    expect(seen).toEqual(["b"]);
  });
});
