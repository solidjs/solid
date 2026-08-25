/**
 * snapshot() on rows accessed through a derived store view (store-in-store).
 *
 * A derived store's STORE_VALUE is the inner store's live proxy — e.g.
 * `createOptimisticStore(base)` where `base` is itself a store. snapshotImpl's
 * no-overlay fast path mapped the row to STORE_VALUE verbatim, so
 * `snapshot(view[i])` returned the base row's live proxy: mutations wrote
 * through to the store and reads tracked/threw strict-read diagnostics.
 * Whole-store snapshots (`snapshot(view)[i]`) were unaffected because array
 * reads through the proxy return wrapped children, which always force a copy.
 */
import { types } from "node:util";
import {
  createOptimisticStore,
  createRoot,
  createStore,
  deep,
  flush,
  snapshot
} from "../src/index.js";

function setup() {
  const [base, setBase] = createStore([{ id: "a", qty: 1, nested: { x: 1 } }]);
  const [view, setView] = createOptimisticStore(base);
  flush();
  return { base, setBase, view, setView };
}

it("snapshot(view[i]) returns plain data, not the base row proxy", () => {
  createRoot(() => {
    const { base, view } = setup();
    const row = snapshot((view as any)[0]);
    expect(types.isProxy(row)).toBe(false);
    expect(types.isProxy((row as any).nested)).toBe(false);
    expect(row).toEqual({ id: "a", qty: 1, nested: { x: 1 } });
    // Consistent with all snapshot forms: plain and mutation-safe.
    expect(types.isProxy(snapshot(base[0] as any))).toBe(false);
    expect(types.isProxy((snapshot(view as any) as any)[0])).toBe(false);
  });
});

it("per-row snapshot through the view matches the base row snapshot identity", () => {
  createRoot(() => {
    const { base, view } = setup();
    // snapshot's copy-on-write contract: with nothing overridden it returns
    // the raw backing object. Through the view it must be the SAME raw object
    // the base store's snapshot yields — not the base row's proxy.
    const viaView = snapshot((view as any)[0]);
    const viaBase = snapshot((base as any)[0]);
    expect(viaView).toBe(viaBase);
    expect(types.isProxy(viaView)).toBe(false);
  });
});

it("snapshot(view[i]) reflects an in-flight optimistic override", () => {
  createRoot(() => {
    const { base, view, setView } = setup();
    setView(d => {
      (d as any)[0].qty = 5;
    });
    const row = snapshot((view as any)[0]) as any;
    expect(types.isProxy(row)).toBe(false);
    expect(row.qty).toBe(5);
    expect((base as any)[0].qty).toBe(1); // base untouched by the overlay
    flush();
  });
});

it("unwraps chained derived stores (view over view)", () => {
  createRoot(() => {
    const { view } = setup();
    const [view2] = createOptimisticStore(view as any);
    flush();
    const row = snapshot((view2 as any)[0]);
    expect(types.isProxy(row)).toBe(false);
    expect(row).toEqual({ id: "a", qty: 1, nested: { x: 1 } });
  });
});

it("deep(view[i]) (tracked snapshot) is also plain", () => {
  createRoot(() => {
    const { view } = setup();
    const row = deep((view as any)[0]);
    expect(types.isProxy(row)).toBe(false);
    expect(types.isProxy((row as any).nested)).toBe(false);
  });
});
