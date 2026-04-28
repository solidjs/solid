import { describe, expect, test } from "vitest";
import { createRoot, createStore, mapArray, flush } from "../src/index.js";

describe("mapArray keyed:false backed by a store (#2687)", () => {
  // Regression: mapArray's internal owner is a Root, so untracked store-proxy
  // reads inside updateKeyedMap saw `_value` (committed) instead of
  // `_pendingValue` (the write currently being processed) and the row signals
  // were updated with stale data. Linking the internal owner's
  // _parentComputed to the mapArray computed routes those reads through it.
  test("row accessor reflects newly written store[i] within the same flush", () => {
    let setStoreRef!: any;
    let refresh!: () => void;
    let snapshot: { items: string[]; direct: string[] } = { items: [], direct: [] };

    const dispose = createRoot(d => {
      const [store, setStore] = createStore<string[]>(["a", "b", "c"]);
      setStoreRef = setStore;

      const mapped = mapArray(
        () => store,
        (item, i) => ({ getItem: () => item(), getDirect: () => store[i()] }),
        { keyed: false }
      );

      refresh = () => {
        const list = mapped();
        snapshot = {
          items: list.map(m => m.getItem()),
          direct: list.map(m => m.getDirect())
        };
      };
      refresh();

      return d;
    });

    setStoreRef((x: string[]) => {
      x[0] = "x";
    });
    flush();
    refresh();

    expect(snapshot).toEqual({ items: ["x", "b", "c"], direct: ["x", "b", "c"] });
    dispose();
  });
});
