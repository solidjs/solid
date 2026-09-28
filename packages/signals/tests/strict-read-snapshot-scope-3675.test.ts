/**
 * #3675 — STRICT_READ_UNTRACKED fires during the hydration pass too.
 *
 * `read()` served a snapshot-scope reader the captured value and returned
 * before the strict-read check, so a component body that read a signal
 * directly warned after client navigation but stayed silent on a fresh SSR
 * load — the console developers are least likely to be watching.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  untrack,
  OBSERVE
} from "../src/index.js";
import { clearSnapshots, markSnapshotScope, setSnapshotCapture } from "../src/core/core.js";

afterEach(() => {
  clearSnapshots();
  flush();
  vi.restoreAllMocks();
});

describe("#3675 strict read under snapshot capture", () => {
  it("a labeled untracked read served from the snapshot still warns", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: any[] = [];
    const unsubscribe = OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "STRICT_READ_UNTRACKED") events.push(e);
    });
    setSnapshotCapture(true);
    let served: number | undefined;
    createRoot(() => {
      markSnapshotScope(getOwner()!);
      const [count] = createSignal(1, { name: "count" });
      // A memo created in the snapshot scope is a snapshot-scope reader; the
      // signal, created under capture, carries a snapshot. Same read a
      // hydrating component body makes.
      createMemo(() => (served = untrack(() => count(), "<Child>")));
    });
    unsubscribe();
    expect(served).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].data?.strictRead).toBe("<Child>");
    expect(events[0].nodeName).toBe("count");
    // The console line names the value read (the report's third point).
    expect(events[0].message).toContain('Reactive value "count" read directly in <Child>');
  });

  it("an unnamed signal keeps the generic message", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: any[] = [];
    const unsubscribe = OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "STRICT_READ_UNTRACKED") events.push(e);
    });
    createRoot(() => {
      const [count] = createSignal(1);
      createMemo(() => untrack(() => count(), "<Child>"));
    });
    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain("Reactive value read directly in <Child>");
  });

  it("control: the same read outside capture warns once", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: any[] = [];
    const unsubscribe = OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "STRICT_READ_UNTRACKED") events.push(e);
    });
    createRoot(() => {
      const [count] = createSignal(1, { name: "count" });
      createMemo(() => untrack(() => count(), "<Child>"));
    });
    unsubscribe();
    expect(events).toHaveLength(1);
  });
});
