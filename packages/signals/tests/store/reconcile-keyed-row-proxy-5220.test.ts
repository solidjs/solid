/**
 * #5220 — a keyed reconcile keeps a key-matched list row's proxy even when
 * nothing ever subscribed to a field of that row, so a reference-keyed
 * `mapArray` (`<For>`) keeps the row. The row is merged one level; the walk
 * still stops below it at never-subscribed children (#2902).
 */
import { describe, expect, it, vi } from "vitest";
import {
  action,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  reconcile,
  snapshot,
  untrack
} from "../../src/index.js";

type Row = { id: string; v: number };

const fetchRows = (bv = 2): Row[] => [
  { id: "a", v: 1 },
  { id: "b", v: bv }
];

function mappedList() {
  const [s, set] = createStore({ rows: fetchRows() });
  let made = 0;
  let out = "";
  const dispose = createRoot(d => {
    // The row body reads nothing of its row.
    const rows = mapArray(
      () => s.rows,
      () => {
        made++;
        return () => "x";
      }
    );
    createRenderEffect(
      () =>
        rows()
          .map(r => r())
          .join(","),
      v => void (out = v)
    );
    return d;
  });
  flush();
  return { s, set, made: () => made, out: () => out, dispose };
}

describe("keyed reconcile keeps a matched row's proxy with nothing subscribed to it (#5220)", () => {
  it("draft form: same ids as new objects, no row is remade", () => {
    const { s, set, made, out, dispose } = mappedList();
    const [rowA, rowB] = s.rows;
    const before = made();

    set(d => {
      reconcile(fetchRows(), "id")(d.rows);
    });
    flush();
    expect(s.rows[0]).toBe(rowA);
    expect(s.rows[1]).toBe(rowB);
    expect(made() - before).toBe(0);
    expect(out()).toBe("x,x");
    dispose();
  });

  it("root form: a changed field on another row, no row is remade", () => {
    const { s, set, made, dispose } = mappedList();
    const [rowA, rowB] = s.rows;
    const before = made();

    set(reconcile({ rows: fetchRows(3) }, "id"));
    flush();
    expect(s.rows[0]).toBe(rowA);
    expect(s.rows[1]).toBe(rowB);
    expect(s.rows[1].v).toBe(3);
    expect(made() - before).toBe(0);
    dispose();
  });

  it("draft form: a reorder moves the rows, none is remade", () => {
    const { s, set, made, dispose } = mappedList();
    const [rowA, rowB] = s.rows;
    const before = made();

    set(d => {
      reconcile(fetchRows().reverse(), "id")(d.rows);
    });
    flush();
    expect(s.rows[0]).toBe(rowB);
    expect(s.rows[1]).toBe(rowA);
    expect(made() - before).toBe(0);
    dispose();
  });

  const setups: [string, (s: { rows: Row[] }, row: Row) => (() => void) | void][] = [
    ["a captured proxy alone", () => {}],
    [
      "an effect tracking the parent slot",
      s =>
        createRoot(d => {
          createRenderEffect(
            () => s.rows[0],
            () => {}
          );
          return d;
        })
    ],
    ["an untracked field read", (_, row) => void untrack(() => row.v)],
    [
      "an effect tracking a field of the row",
      (_, row) =>
        createRoot(d => {
          createRenderEffect(
            () => row.v,
            () => {}
          );
          return d;
        })
    ]
  ];

  it.each(setups)("%s: the captured row is kept across two reconciles", (_, setup) => {
    const [s, set] = createStore({ rows: fetchRows() });
    const row = s.rows[0];
    const dispose = setup(s, row);
    flush();

    for (let i = 0; i < 2; i++) {
      set(d => {
        reconcile(fetchRows(), "id")(d.rows);
      });
      flush();
      expect(s.rows[0]).toBe(row);
    }
    dispose?.();
  });

  it("a changed row's new value reads through the kept proxy", () => {
    const [s, set] = createStore({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2, extra: true }
      ] as (Row & { extra?: boolean })[]
    });
    const rowB = s.rows[1];

    set(d => {
      reconcile(
        [
          { id: "a", v: 1 },
          { id: "b", v: 3 }
        ],
        "id"
      )(d.rows);
    });
    flush();
    expect(s.rows[1]).toBe(rowB);
    expect(rowB.v).toBe(3);
    expect("extra" in rowB).toBe(false);
    expect(Object.keys(rowB)).toEqual(["id", "v"]);

    // A subscriber made after the merge sees the next change.
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(
        () => rowB.v,
        v => void seen.push(v)
      );
      return d;
    });
    flush();
    set(d => {
      reconcile(
        [
          { id: "a", v: 1 },
          { id: "b", v: 4 }
        ],
        "id"
      )(d.rows);
    });
    flush();
    expect(s.rows[1]).toBe(rowB);
    expect(seen).toEqual([3, 4]);
    dispose();
  });

  it("the walk stops below the matched row: never-subscribed children are swapped, not walked", () => {
    const make = (v: number) => [
      { id: 1, child: { id: 10, deep: { id: 100, v } }, items: [{ id: 5, v }] }
    ];
    const [s, set] = createStore({ rows: make(1) });
    const row = s.rows[0];
    const child = row.child; // captured, never subscribed

    // keyFn runs once per wrappable pair the diff key-compares.
    const visited: any[] = [];
    const keyFn = vi.fn((item: any) => {
      visited.push(item);
      return item.id;
    });
    set(d => {
      reconcile(make(2), keyFn)(d.rows);
    });
    flush();
    expect(s.rows[0]).toBe(row);
    // Only the rows were key-compared; nothing below them.
    expect(visited.filter(i => !Array.isArray(i)).every(i => "child" in i)).toBe(true);
    expect(visited.some(i => !Array.isArray(i) && "child" in i)).toBe(true);
    // The never-subscribed child took the new raw whole: a capture of it
    // detaches (the pruning contract), fresh reads see the new data.
    expect(row.child).not.toBe(child);
    expect(child.deep.v).toBe(1);
    expect(row.child.deep.v).toBe(2);
    expect(row.items[0].v).toBe(2);
  });
});

describe("key-matched rows use the store's write and identity rules", () => {
  it("stages values like an ordinary write and composes across setters (F-10)", () => {
    const [state, set] = createStore({ rows: fetchRows(), ordinary: 2 });
    const row = state.rows[1];

    set(draft => {
      reconcile(fetchRows(3), "id")(draft.rows);
      draft.ordinary = 3;
      expect(draft.rows[1]).toBe(row);
      expect(row.v).toBe(draft.ordinary);
    });
    expect(state.rows[1]).toBe(row);
    expect(row.v).toBe(state.ordinary);
    expect(snapshot(state).rows[1].v).toBe(2);

    set(draft => {
      expect(draft.rows[1].v).toBe(3);
      reconcile(fetchRows(5), "id")(draft.rows);
      draft.rows[1].v++;
      draft.ordinary = 6;
    });
    expect(row.v).toBe(2);
    flush();
    expect(state.rows[1]).toBe(row);
    expect(row.v).toBe(6);
    expect(row.v).toBe(state.ordinary);
  });

  it("a held reconcile and a copy from its draft publish together (F-1, D-33)", async () => {
    const [state, set] = createStore({ rows: fetchRows(), copy: 2 });
    const row = state.rows[1];
    const gate = Promise.withResolvers<void>();
    const update = action(function* () {
      set(draft => {
        reconcile(fetchRows(3), "id")(draft.rows);
      });
      yield gate.promise;
    });

    const done = update();
    flush();
    expect(state.rows[1]).toBe(row);
    expect(row.v).toBe(2);
    set(draft => {
      draft.copy = draft.rows[1].v;
    });
    flush();
    expect(state.copy).toBe(2);

    // A reader first attached after the reconcile must still see both frames.
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(
        () => row.v,
        value => void seen.push(value)
      );
      return d;
    });
    try {
      flush();
      expect(seen).toEqual([2]);
      gate.resolve();
      await done;
      flush();
      expect(state.rows[1]).toBe(row);
      expect(state.copy).toBe(3);
      expect(seen).toEqual([2, 3]);
    } finally {
      gate.resolve();
      dispose();
    }
  });

  it("updates aliases of the old raw and leaves snapshots coherent", () => {
    const original = { id: "a", v: 1 };
    const next = { id: "a", v: 2 };
    const [state, set] = createStore({ rows: [original], selected: original });
    const row = state.rows[0];

    set(draft => {
      reconcile([next], "id")(draft.rows);
    });
    flush();

    expect(state.rows[0]).toBe(row);
    expect(state.selected).toBe(row);
    expect(state.selected.v).toBe(2);
    const copy = snapshot(state);
    expect(copy.selected).toBe(copy.rows[0]);
    expect(copy.selected.v).toBe(2);
    expect(original.v).toBe(1);

    // Re-sending the same source restores values changed through an alias.
    set(draft => {
      draft.selected.v = 3;
    });
    flush();
    expect(row.v).toBe(3);
    set(draft => {
      reconcile([next], "id")(draft.rows);
    });
    flush();
    expect(row.v).toBe(2);

    // If the incoming raw is used independently, it has its own identity.
    const [other] = createStore([next]);
    expect(other[0]).not.toBe(row);
  });

  it("updates a descendant observed through a different path", () => {
    const child = { id: 1, v: 1 };
    const [state, set] = createStore({ selected: child, rows: [{ id: "a", child }] });
    const seen: number[] = [];
    // The child's first parent is the root, so tracking it leaves the row node-less.
    const dispose = createRoot(d => {
      createRenderEffect(
        () => state.selected.v,
        value => void seen.push(value)
      );
      return d;
    });
    try {
      flush();
      const row = state.rows[0];
      set(draft => {
        reconcile([{ id: "a", child: { id: 1, v: 2 } }], "id")(draft.rows);
      });
      flush();

      expect(state.rows[0]).toBe(row);
      expect(row.child).toBe(state.selected);
      expect(seen).toEqual([1, 2]);
    } finally {
      dispose();
    }
  });

  it("keeps an accessor live if it already answers the incoming value", () => {
    let value = 1;
    const [rows, set] = createStore([
      {
        id: "a",
        get v() {
          return value;
        }
      }
    ]);
    const row = rows[0];

    set(
      reconcile(
        [
          {
            id: "a",
            get v() {
              value = 2;
              return value;
            }
          }
        ],
        "id"
      )
    );
    flush();
    expect(rows[0]).toBe(row);
    expect(row.v).toBe(2);
    value = 3;
    expect(row.v).toBe(3);
  });

  it("keeps derived row identity across a keyed answer", () => {
    const dispose = createRoot(d => {
      const [value, setValue] = createSignal(2, { ownedWrite: true });
      const rows = createProjection(() => fetchRows(value()), [] as Row[]);
      const row = rows[1];
      setValue(3);
      expect(row.v).toBe(2);
      flush();
      expect(rows[1]).toBe(row);
      expect(row.v).toBe(3);
      return d;
    });
    dispose();
  });

  it("an optimistic keyed reconcile reveals and reverts in its action (F-10, F-11)", async () => {
    const [rows, set] = createOptimisticStore(fetchRows());
    const row = rows[1];
    const gate = Promise.withResolvers<void>();
    const update = action(function* () {
      set(reconcile(fetchRows(3), "id"));
      yield gate.promise;
    });

    const done = update();
    try {
      expect(row.v).toBe(2);
      flush();
      expect(rows[1]).toBe(row);
      expect(row.v).toBe(3);
    } finally {
      gate.resolve();
      await done;
      flush();
    }
    expect(rows[1]).toBe(row);
    expect(row.v).toBe(2);
  });
});
