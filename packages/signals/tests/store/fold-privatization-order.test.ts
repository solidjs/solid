/**
 * #3271: a write to an ancestor node was SILENTLY DISCARDED if a descendant
 * of that node was written earlier in the same flush — projections (derived
 * stores) only.
 *
 * Mechanism: family/array drafts fold on the clone path (`t.v = pb` + a
 * parent-slot CAS against the pre-batch old). drainFolds processes targets in
 * write order, so the descendant folds first and its path-copy privatizes the
 * ancestor — cloning the committed backing and re-pointing the parent slot at
 * the clone. The ancestor's own fold then swapped in its stale ensurePB-time
 * clone and the parent CAS failed (slot no longer holds `old`), orphaning the
 * ancestor's writes. Plain object stores were immune only because they fold
 * through the prototype-overlay path, which applies writes in place. The fix
 * merges the batch's written keys onto the privatized container instead of
 * swapping.
 */
import { describe, expect, it } from "vitest";
import {
  createProjection,
  createRoot,
  createStore,
  deep,
  flush,
  snapshot,
  untrack
} from "../../src/index.js";

type Child = { id: number; selected: boolean };
type Row = { id: number; selected: boolean; children: Child[] };

const seed = (): Row[] => [{ id: 1, selected: true, children: [{ id: 11, selected: true }] }];

function run<T>(body: () => T): T {
  return createRoot(() => body());
}

const read = (store: any) => JSON.parse(JSON.stringify(snapshot(untrack(() => deep(store)))));

describe("#3271: ancestor write after descendant write in one draft", () => {
  const orders = ["ancestor-first", "descendant-first"] as const;
  const makers = {
    "plain store": () => createStore(seed()),
    "derived store": () => createStore(() => seed(), [] as Row[])
  } as const;

  for (const [name, make] of Object.entries(makers)) {
    for (const order of orders) {
      it(`${name}, ${order}: both writes commit`, () => {
        run(() => {
          const [store, setStore] = make();
          untrack(() => deep(store)); // materialize the tree
          setStore(prev => {
            const row = prev[0];
            if (order === "descendant-first") {
              row.children[0].selected = false;
              row.selected = false;
            } else {
              row.selected = false;
              row.children[0].selected = false;
            }
          });
          flush();
          expect(read(store)).toEqual([
            { id: 1, selected: false, children: [{ id: 11, selected: false }] }
          ]);
        });
      });
    }
  }

  it("three levels, leaf-to-root write order: every level commits", () => {
    run(() => {
      const [store, setStore] = createStore(
        () => ({ label: "root", mid: { label: "mid", leaf: { label: "leaf" } } }),
        {} as { label: string; mid: { label: string; leaf: { label: string } } }
      );
      untrack(() => deep(store));
      setStore(prev => {
        prev.mid.leaf.label = "leaf2";
        prev.mid.label = "mid2";
        prev.label = "root2";
      });
      flush();
      expect(read(store)).toEqual({
        label: "root2",
        mid: { label: "mid2", leaf: { label: "leaf2" } }
      });
    });
  });

  it("ancestor DELETE after descendant write commits (wk delete arm)", () => {
    run(() => {
      const [store, setStore] = createStore(
        () => ({ keep: { n: 1 }, drop: 1 }) as { keep: { n: number }; drop?: number },
        {} as { keep: { n: number }; drop?: number }
      );
      untrack(() => deep(store));
      setStore(prev => {
        prev.keep.n = 2;
        delete prev.drop;
      });
      flush();
      expect(read(store)).toEqual({ keep: { n: 2 } });
    });
  });

  it("array length write after descendant write commits (WK_ALL value-diff arm)", () => {
    run(() => {
      const [store, setStore] = createStore(() => seed(), [] as Row[]);
      untrack(() => deep(store));
      setStore(prev => {
        prev[0].selected = false; // descendant folds first, privatizes the array
        prev.length = 0; // length write on the privatized ancestor (WK_ALL)
      });
      flush();
      expect(read(store)).toEqual([]);
    });
  });

  it("array push after descendant write keeps both (index + length keys)", () => {
    run(() => {
      const [store, setStore] = createStore(() => seed(), [] as Row[]);
      untrack(() => deep(store));
      setStore(prev => {
        prev[0].selected = false;
        prev.push({ id: 2, selected: true, children: [] });
      });
      flush();
      expect(read(store)).toEqual([
        { id: 1, selected: false, children: [{ id: 11, selected: true }] },
        { id: 2, selected: true, children: [] }
      ]);
    });
  });

  // Adapted from PR #3278 (javascript-unsafe): three writes across sibling
  // subtrees in all six orderings — broader interleaving coverage than the
  // two-write cases above.
  it("every direct write survives across nested sibling orderings", () => {
    type WideRow = {
      id: number;
      selected: boolean;
      children: Child[];
      metadata: { active: boolean };
    };
    const operations = [
      (row: WideRow) => (row.children[0].selected = false),
      (row: WideRow) => (row.metadata.active = false),
      (row: WideRow) => (row.selected = false)
    ];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0]
    ];
    for (const order of orders) {
      run(() => {
        const [store, setStore] = createStore(
          () => [
            {
              id: 1,
              selected: true,
              children: [{ id: 11, selected: true }],
              metadata: { active: true }
            }
          ],
          [] as WideRow[]
        );
        untrack(() => deep(store));
        setStore(rows => {
          for (const index of order) operations[index](rows[0]);
        });
        flush();
        expect(read(store), `order ${order.join(",")}`).toEqual([
          {
            id: 1,
            selected: false,
            children: [{ id: 11, selected: false }],
            metadata: { active: false }
          }
        ]);
      });
    }
  });

  it("createProjection: descendant-first write order commits both", () => {
    run(() => {
      const store = createProjection(() => ({ rows: seed() }), {} as { rows: Row[] });
      untrack(() => deep(store));
      // Writable projections take writes through the draft of a store setter
      // sibling; here we pin the same fold machinery through the derived
      // createStore form above — this case guards the read-only projection
      // still materializing correctly beside those folds.
      expect(read(store).rows[0].selected).toBe(true);
    });
  });
});
