// #3282 (repro by @brenelz): an array move (reverse/unshift/splice) relocates
// a row's raw, but the row target's parent-key (pk) is stamped at WRAP time —
// so a fold of an edited moved row re-pointed the WRAP-TIME slot, cloning the
// row over whichever sibling lived there now ([1,2] became [1,1]). Fold-time
// parent-slot writes now resolve the slot by raw identity. The deep()-observed
// variants pin that the fix holds regardless of pre-existing child targets.
import {
  createRenderEffect,
  createRoot,
  createStore,
  deep,
  flush,
  snapshot,
  untrack
} from "../../src/index.ts";

for (const operation of ["unshift", "reverse", "splice"] as const) {
  for (const observed of [false, true]) {
    it(`${operation} then a row edit preserves other rows (${observed ? "deep observed" : "unobserved"})`, () => {
      let dispose!: () => void;
      const initial = [
        { id: 1, count: 0 },
        { id: 2, count: 0 }
      ];
      const expected = structuredClone(initial);
      const [store, setStore] = createRoot(d => {
        dispose = d;
        const pair = createStore(initial);
        if (observed)
          createRenderEffect(
            () => deep(pair[0]),
            () => {}
          );
        return pair;
      });
      const edit = (rows: typeof initial) => {
        if (operation === "unshift") rows.unshift({ id: 3, count: 0 });
        else if (operation === "reverse") rows.reverse();
        else rows.splice(0, 0, { id: 3, count: 0 });
        rows[1].count++;
      };
      try {
        flush();
        edit(expected);
        setStore(edit);
        flush();
        expect(untrack(() => snapshot(store))).toEqual(expected);
        expect(initial).toEqual([
          { id: 1, count: 0 },
          { id: 2, count: 0 }
        ]);
      } finally {
        dispose();
      }
    });
  }
}
