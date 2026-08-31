import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal, createStore, DEV, flush, registerPatch } from "../src/index.js";

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

  it("structural dispatches record synthetic attribution events", async () => {
    const { registerRowOps, reconcile } = await import("../src/index.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false });
    const events: any[] = [];
    DEV!.attribution.subscribe(e => events.push(e));
    const [state, setState] = createStore<any>({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 }
      ]
    });
    createRoot(() => {
      (registerRowOps as any)(state.rows, () => {});
    });
    // Keyed insert: the reconcile walk emits row ops.
    setState((s: any) => {
      (reconcile as any)(
        [
          { id: "a", v: 1 },
          { id: "c", v: 3 },
          { id: "b", v: 2 }
        ],
        "id"
      )(s.rows);
    });
    flush();
    const structural = events.find(e => String(e.nodeName).startsWith("row-ops("));
    expect(structural).toBeDefined();
    expect(structural.nodeName).toContain("store.rows");
  });

  it("coalesced multi-child batches list every origin once; self-emissions keep them", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false });
    const events: any[] = [];
    DEV!.attribution.subscribe(e => events.push(e));
    const [state, setState] = createStore<any>({
      list: { a: { v: 1 }, b: { v: 2 }, own: 0 }
    });
    createRoot(() => {
      registerPatch(state.list, () => {}, ["own"]);
      registerPatch(state.list.a, () => {}, ["v"]);
      registerPatch(state.list.b, () => {}, ["v"]);
    });
    // One batch: child A twice (one cause, not two), child B once, and a
    // PARENT self write (which must not erase the children).
    setState((s: any) => {
      s.list.a.v = 10;
      s.list.a.v = 11;
      s.list.b.v = 20;
      s.list.own = 1;
    });
    flush();
    const parent = events.find(e => e.nodeName === "patchDelivery(store.list)");
    expect(parent).toBeDefined();
    const names = parent.causes.flatMap((c: any) => [
      c.name,
      ...(c.causes?.map((x: any) => x.name) ?? [])
    ]);
    expect(names.filter((n: string) => n === "store.list.a").length).toBe(1);
    expect(names.filter((n: string) => n === "store.list.b").length).toBe(1);
    expect(names).toContain("store.list");
  });

  it("demoted children contribute name-only origins, never stale stamps", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [dep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ row: { meta: { id: 1, label: "x" } } });
    createRoot(() => {
      registerPatch(state.row.meta, () => {}, ["label"]);
      registerPatch(state.row, () => {}, ["meta.id"]);
    });
    // Build the child's machinery, then demote it with a stamped write in
    // its history.
    setState((s: any) => {
      s.row.meta.label = "stamped";
    });
    flush();
    DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false });
    const events: any[] = [];
    DEV!.attribution.subscribe(e => events.push(e));
    setState((s: any) => {
      Object.defineProperty(s.row.meta, "label", {
        get() {
          return dep();
        },
        configurable: true,
        enumerable: true
      });
    });
    flush();
    events.length = 0;
    // A nested write on the DEMOTED child bubbles: the ancestor's cause
    // must be the child's PATH (name-only), not the stale pre-demotion
    // delivery stamp.
    setState((s: any) => {
      s.row.meta.id = 2;
    });
    flush();
    const ancestor = events.find(e => e.nodeName === "patchDelivery(store.row)");
    expect(ancestor).toBeDefined();
    const childCause = (ancestor.causes as any[])
      .flatMap((c: any) => [c, ...(c.causes ?? [])])
      .find((c: any) => c.name === "store.row.meta");
    expect(childCause).toBeDefined();
    expect(childCause.value).toBeUndefined(); // name-only, no stale previews
  });

  it("ancestor deliveries report the ORIGINATING child as the write source", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.attribution.enable({ log: false, hotRuns: false, hotTime: false });
    const events: any[] = [];
    DEV!.attribution.subscribe(e => events.push(e));
    const [state, setState] = createStore<any>({ rows: [{ id: 1, label: "a" }] });
    createRoot(() => {
      // Ancestor consumer: its deliveries come from nested-child bubbles.
      registerPatch(state.rows, () => {}, ["length"]);
      registerPatch(state.rows[0], () => {}, ["label"]);
    });
    setState((s: any) => {
      s.rows[0].label = "b";
    });
    flush();
    const ancestor = events.find(e => e.nodeName === "patchDelivery(store.rows)");
    expect(ancestor).toBeDefined();
    // The bubble's stamp names the ancestor, but its CAUSE is the child.
    expect(ancestor.causes[0].name).toBe("store.rows");
    expect(ancestor.causes[0].causes?.[0]?.name).toBe("store.rows.0");
  });
});
