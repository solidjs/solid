import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, createStore, DEV, flush, registerPatch } from "../src/index.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

describe("attribution through patch deliveries", () => {
  it("a patched record write produces a named, value-carrying cause chain", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false });
    const events: any[] = [];
    DEV!.attribution.subscribe(e => events.push(e));
    const [state, setState] = createStore<any>({ rows: [{ id: 1, label: "a" }] });
    createRoot(() => {
      registerPatch(state.rows[0], () => {}, ["label"]);
    });
    setState((s: any) => {
      s.rows[0].label = "b";
    });
    flush();
    // The delivery effect's rerun event IS the "why did this run" record
    // for the patch-applied DOM update: machinery names itself with the
    // record's store path, and the cause stamp carries the record
    // transition — not the delivery counter.
    const delivery = events.find(e => String(e.nodeName).startsWith("patchDelivery("));
    expect(delivery).toBeDefined();
    expect(delivery.nodeName).toContain("store.rows.0");
    expect(delivery.causes.length).toBeGreaterThan(0);
    expect(delivery.causes[0].name).toBe("store.rows.0");
    expect(delivery.causes[0].kind).toBe("write");
    // Self emission carried the record transition previews.
    expect(String(delivery.causes[0].value)).toContain("b");
  });
});
