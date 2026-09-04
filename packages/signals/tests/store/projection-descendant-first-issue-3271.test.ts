import { expect, test } from "vitest";
import { createRoot, createStore, deep, flush, snapshot, untrack } from "../../src/index.js";

const expected = JSON.stringify([
  { id: 1, selected: false, children: [{ id: 11, selected: false }] }
]);

function seed() {
  return [{ id: 1, selected: true, children: [{ id: 11, selected: true }] }];
}

function scenario(projection: boolean, descendantFirst: boolean) {
  return createRoot(() => {
    const [store, setStore] = projection ? createStore(() => seed(), []) : createStore(seed());
    untrack(() => deep(store));
    setStore(prev => {
      const row = prev[0];
      const child = row.children[0];
      if (descendantFirst) {
        child.selected = false;
        row.selected = false;
      } else {
        row.selected = false;
        child.selected = false;
      }
    });
    flush();
    return JSON.stringify(snapshot(untrack(() => deep(store))));
  });
}

test("projection stores retain an ancestor write after an earlier descendant write (#3271)", () => {
  for (const projection of [false, true]) {
    for (const descendantFirst of [false, true]) {
      expect(scenario(projection, descendantFirst)).toBe(expected);
    }
  }
});

test("projection folds preserve every direct write across nested sibling orderings (#3271)", () => {
  const operations = [
    (row: any) => (row.children[0].selected = false),
    (row: any) => (row.metadata.active = false),
    (row: any) => (row.selected = false)
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
    const result = createRoot(() => {
      const [store, setStore] = createStore(
        () => [
          {
            id: 1,
            selected: true,
            children: [{ id: 11, selected: true }],
            metadata: { active: true }
          }
        ],
        []
      );
      untrack(() => deep(store));
      setStore(rows => {
        for (const index of order) operations[index](rows[0]);
      });
      flush();
      return JSON.stringify(snapshot(untrack(() => deep(store))));
    });
    expect(result).toBe(
      JSON.stringify([
        {
          id: 1,
          selected: false,
          children: [{ id: 11, selected: false }],
          metadata: { active: false }
        }
      ])
    );
  }
});
