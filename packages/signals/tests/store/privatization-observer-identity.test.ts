// #3284 (repro by @brenelz): privatizeCommitted registered its clone only in
// the GLOBAL lookup, but derived stores (families) resolve children through
// fam.map — so after a descendant write privatized an ancestor, the next
// parent read missed the map, wrapped a FRESH target (new proxy identity),
// and every node on the original target (the observer's subscription among
// them) was orphaned: later writes to the ancestor notified nobody. The clone
// now registers in the target's own map; identity and subscriptions survive.
import { createRenderEffect, createRoot, createStore, flush, untrack } from "../../src/index.ts";

describe("subscriptions after descendant writes", () => {
  for (const derived of [false, true]) {
    it(`${derived ? "derived" : "plain"} store keeps an ancestor observer connected`, () => {
      const seed = () => ({ row: { selected: true, child: { count: 0 } } });
      let dispose!: () => void;
      const seen: boolean[] = [];
      const [store, setStore] = createRoot(d => {
        dispose = d;
        const pair = derived ? createStore(seed, seed()) : createStore(seed());
        createRenderEffect(
          () => pair[0].row.selected,
          value => {
            seen.push(value);
          }
        );
        return pair;
      });
      try {
        flush();
        const originalRow = untrack(() => store.row);
        setStore(draft => {
          draft.row.child.count = 1;
        });
        flush();
        setStore(draft => {
          draft.row.selected = false;
        });
        flush();
        expect(untrack(() => store.row.selected)).toBe(false);
        expect.soft(seen).toEqual([true, false]);
        expect(untrack(() => store.row === originalRow)).toBe(true);
      } finally {
        dispose();
      }
    });
  }
});
