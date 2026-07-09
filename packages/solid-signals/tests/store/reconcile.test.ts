import { describe, expect, test } from "vitest";
import {
  createStore,
  reconcile,
  snapshot,
  $TRACK,
  createMemo,
  createRoot,
  createEffect,
  createRenderEffect,
  flush
} from "../../src/index.js";

describe("setState with reconcile", () => {
  test("Reconcile a simple object", () => {
    const [state, setState] = createStore<{ data: number; missing?: string }>({
      data: 2,
      missing: "soon"
    });
    expect(state.data).toBe(2);
    expect(state.missing).toBe("soon");
    setState(reconcile({ data: 5 }, "id"));
    expect(state.data).toBe(5);
    expect(state.missing).toBeUndefined();
  });

  test("Reconcile array with nulls", () => {
    const [state, setState] = createStore<Array<string | null>>([null, "a"]);
    expect(state[0]).toBe(null);
    expect(state[1]).toBe("a");
    setState(reconcile(["b", null], "id"));
    expect(state[0]).toBe("b");
    expect(state[1]).toBe(null);
  });

  test("Reconcile a simple object on a nested path", () => {
    const [state, setState] = createStore<{
      data: { user: { firstName: string; middleName: string; lastName?: string } };
    }>({
      data: { user: { firstName: "John", middleName: "", lastName: "Snow" } }
    });
    expect(state.data.user.firstName).toBe("John");
    expect(state.data.user.lastName).toBe("Snow");
    setState(s => {
      reconcile({ firstName: "Jake", middleName: "R" }, "id")(s.data.user);
    });
    expect(state.data.user.firstName).toBe("Jake");
    expect(state.data.user.middleName).toBe("R");
    expect(state.data.user.lastName).toBeUndefined();
  });

  test("Reconcile reorder a keyed array", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" },
      ARYA = { id: 4, firstName: "Arya", lastName: "Start" };
    const [state, setState] = createStore({ users: [JOHN, NED, BRANDON] });
    expect(Object.is(snapshot(state.users[0]), JOHN)).toBe(true);
    expect(Object.is(snapshot(state.users[1]), NED)).toBe(true);
    expect(Object.is(snapshot(state.users[2]), BRANDON)).toBe(true);
    setState(s => {
      reconcile([NED, JOHN, BRANDON], "id")(s.users);
    });
    expect(Object.is(snapshot(state.users[0]), NED)).toBe(true);
    expect(Object.is(snapshot(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(snapshot(state.users[2]), BRANDON)).toBe(true);
    setState(s => {
      reconcile([NED, BRANDON, JOHN], "id")(s.users);
    });
    expect(Object.is(snapshot(state.users[0]), NED)).toBe(true);
    expect(Object.is(snapshot(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(snapshot(state.users[2]), JOHN)).toBe(true);
    setState(s => {
      reconcile([NED, BRANDON, JOHN, ARYA], "id")(s.users);
    });
    expect(Object.is(snapshot(state.users[0]), NED)).toBe(true);
    expect(Object.is(snapshot(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(snapshot(state.users[2]), JOHN)).toBe(true);
    expect(Object.is(snapshot(state.users[3]), ARYA)).toBe(true);
    setState(s => {
      reconcile([BRANDON, JOHN, ARYA], "id")(s.users);
    });
    expect(Object.is(snapshot(state.users[0]), BRANDON)).toBe(true);
    expect(Object.is(snapshot(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(snapshot(state.users[2]), ARYA)).toBe(true);
  });

  test("Reconcile overwrite in non-keyed merge mode", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" };
    const [state, setState] = createStore({
      users: [{ ...JOHN }, { ...NED }, { ...BRANDON }]
    });
    expect(state.users[0].id).toBe(1);
    expect(state.users[0].firstName).toBe("John");
    expect(state.users[1].id).toBe(2);
    expect(state.users[1].firstName).toBe("Ned");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
    setState(s => {
      reconcile([{ ...NED }, { ...JOHN }, { ...BRANDON }], "")(s.users);
    });
    expect(state.users[0].id).toBe(2);
    expect(state.users[0].firstName).toBe("Ned");
    expect(state.users[1].id).toBe(1);
    expect(state.users[1].firstName).toBe("John");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
  });

  test("Reconcile top level key mismatch", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" };

    const [user, setUser] = createStore(JOHN);
    expect(user.id).toBe(1);
    expect(user.firstName).toBe("John");
    expect(() => setUser(reconcile(NED, "id"))).toThrow();
    // expect(user.id).toBe(2);
    // expect(user.firstName).toBe("Ned");
  });

  test("Reconcile nested top level key mismatch", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" };

    const [user, setUser] = createStore({ user: JOHN });
    expect(user.user.id).toBe(1);
    expect(user.user.firstName).toBe("John");
    expect(() =>
      setUser(s => {
        reconcile(NED, "id")(s.user);
      })
    ).toThrow();
    // expect(user.user.id).toBe(2);
    // expect(user.user.firstName).toBe("Ned");
  });

  test("Reconcile top level key missing", () => {
    const [store, setStore] = createStore<{ id?: number; value?: string }>({
      id: 0,
      value: "value"
    });
    expect(() => setStore(reconcile({}, "id"))).toThrow();
    // expect(store.id).toBe(undefined);
    // expect(store.value).toBe(undefined);
  });

  test("Reconcile overwrite an object with an array", () => {
    const [store, setStore] = createStore<{ value: {} | [] }>({
      value: { a: { b: 1 } }
    });

    setStore(reconcile({ value: { c: [1, 2, 3] } }, "id"));
    expect(store.value).toEqual({ c: [1, 2, 3] });
  });

  test("Reconcile overwrite an array with an object", () => {
    const [store, setStore] = createStore<{ value: {} | [] }>({
      value: [1, 2, 3]
    });
    setStore(reconcile({ value: { name: "John" } }, "id"));
    expect(Array.isArray(store.value)).toBeFalsy();
    expect(store.value).toEqual({ name: "John" });
    setStore(reconcile({ value: [1, 2, 3] }, "id"));
    expect(store.value).toEqual([1, 2, 3]);
    setStore(reconcile({ value: { q: "aa" } }, "id"));
    expect(store.value).toEqual({ q: "aa" });
  });
  test("Reconcile keyed trailing removal notifies $TRACK subscribers", () => {
    let effectRunCount = 0;
    const [state, setState] = createStore({ arr: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    createRoot(() => {
      createRenderEffect(
        () => {
          effectRunCount++;
          // accessing $TRACK subscribes to ownKeys notifications on arr
          (state.arr as any)[$TRACK];
          return undefined;
        },
        () => undefined
      );
    });
    // flush to run the effect initially
    flush();
    const runsBefore = effectRunCount;
    setState(s => {
      reconcile([{ id: 1 }, { id: 2 }], "id")(s.arr);
    });
    // flush to propagate invalidation and re-run the effect
    flush();
    expect(effectRunCount).toBeGreaterThan(runsBefore);
  });

  test("Reconcile overwrite tracked array with object updates the signal node", () => {
    const [store, setStore] = createStore<{ value: any }>({ value: [1, 2] });
    let derived: any;

    // Establish a tracking subscription on store.value so a signal node is created for it
    createRoot(() => {
      derived = createMemo(() => store.value);
    });
    expect(Array.isArray(derived())).toBe(true);

    setStore(reconcile({ value: { a: 1 } }, "id"));
    flush();

    expect(Array.isArray(derived())).toBe(false);
    expect((derived() as any).a).toBe(1);
  });

  test("Keyed reconcile preserves null entries between keyed objects (#2772)", () => {
    const [state, setState] = createStore<Array<{ id: number; value?: string } | null>>([
      { id: 1 },
      null,
      { id: 2 }
    ]);
    setState(reconcile([{ id: 1 }, null, { id: 2, value: "updated" }], "id"));
    expect(snapshot(state)).toEqual([{ id: 1 }, null, { id: 2, value: "updated" }]);
  });

  test("Keyed reconcile preserves object identity when the first entry is null", () => {
    const [state, setState] = createStore<Array<{ id: number } | null>>([
      null,
      { id: 1 },
      { id: 2 }
    ]);
    const first = state[1];
    const second = state[2];

    setState(reconcile([null, { id: 2 }, { id: 1 }], "id"));

    expect(state[1]).toBe(second);
    expect(state[2]).toBe(first);
  });

  test("Keyed reconcile replaces a keyed object with a primitive (#2772)", () => {
    const [state, setState] = createStore<Array<{ id: number; value: string } | number>>([
      { id: 1, value: "object" }
    ]);
    setState(reconcile([5], "id"));
    expect(snapshot(state)).toEqual([5]);
  });

  test("Reconcile keyed array shrink notifies tracked index reads and clears stale values", () => {
    const [state, setState] = createStore<{ id: number }[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    let last: { id: number } | undefined;
    createRoot(() => {
      createEffect(
        () => state[2],
        v => {
          last = v;
        }
      );
    });
    flush();
    expect(last).toEqual({ id: 3 });

    setState(reconcile([{ id: 1 }], "id"));
    flush();

    expect(state.length).toBe(1);
    expect(last).toBe(undefined);
    // untracked reads must agree with length, not the stale node cache
    expect(state[2]).toBe(undefined);
  });

  test("Reconcile non-keyed array shrink notifies tracked index reads", () => {
    const [state, setState] = createStore<string[]>(["a", "b", "c"]);
    let last: string | undefined;
    createRoot(() => {
      createEffect(
        () => state[1],
        v => {
          last = v;
        }
      );
    });
    flush();
    expect(last).toBe("b");

    setState(reconcile(["a"], "id"));
    flush();

    expect(state.length).toBe(1);
    expect(last).toBe(undefined);
    expect(state[1]).toBe(undefined);
  });

  test("Reconcile to empty array clears tracked index reads", () => {
    const [state, setState] = createStore<{ id: number }[]>([{ id: 1 }, { id: 2 }]);
    let last: { id: number } | undefined;
    createRoot(() => {
      createEffect(
        () => state[0],
        v => {
          last = v;
        }
      );
    });
    flush();
    expect(last).toEqual({ id: 1 });

    const empty: { id: number }[] = [];
    setState(reconcile(empty, "id"));
    flush();

    expect(state.length).toBe(0);
    expect(last).toBe(undefined);
    expect(state[0]).toBe(undefined);
  });

  test("Reconcile array resize updates tracked `in` checks in both directions", () => {
    const [state, setState] = createStore<{ id: number }[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    let has2: boolean | undefined;
    let has5: boolean | undefined;
    createRoot(() => {
      createEffect(
        () => 2 in state,
        v => {
          has2 = v;
        }
      );
      createEffect(
        () => 5 in state,
        v => {
          has5 = v;
        }
      );
    });
    flush();
    expect(has2).toBe(true);
    expect(has5).toBe(false);

    setState(reconcile([{ id: 1 }], "id"));
    flush();
    expect(has2).toBe(false);
    expect(2 in state).toBe(false);

    setState(reconcile([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }], "id"));
    flush();
    expect(has2).toBe(true);
    expect(has5).toBe(true);
    expect(5 in state).toBe(true);
  });

  test("Reconcile array growth notifies tracked reads of previously missing indices", () => {
    const [state, setState] = createStore<{ id: number }[]>([{ id: 1 }]);
    let last: { id: number } | undefined;
    createRoot(() => {
      createEffect(
        () => state[2],
        v => {
          last = v;
        }
      );
    });
    flush();
    expect(last).toBe(undefined);

    setState(reconcile([{ id: 1 }, { id: 2 }, { id: 3 }], "id"));
    flush();

    expect(last).toEqual({ id: 3 });
  });

  test("Reconcile array shrink preserves tracked named array props that remain present", () => {
    // numeric-coercible names ("1e3" -> 1000, "1.5") are properties, not indices;
    // node sync is membership-based so they must survive a resize that keeps them
    type RowsWithProps = { id: number }[] & { "1e3"?: string; "1.5"?: string };
    const prev: RowsWithProps = Object.assign([{ id: 1 }, { id: 2 }, { id: 3 }], {
      "1e3": "kept",
      "1.5": "decimal"
    });
    const [state, setState] = createStore(prev);
    let exponential: string | undefined;
    let decimal: string | undefined;
    createRoot(() => {
      createEffect(
        () => state["1e3"],
        v => {
          exponential = v;
        }
      );
      createEffect(
        () => state["1.5"],
        v => {
          decimal = v;
        }
      );
    });
    flush();
    expect(exponential).toBe("kept");
    expect(decimal).toBe("decimal");

    const next: RowsWithProps = Object.assign([{ id: 1 }], {
      "1e3": "kept",
      "1.5": "decimal"
    });
    setState(reconcile(next, "id"));
    flush();

    expect(state["1e3"]).toBe("kept");
    expect(state["1.5"]).toBe("decimal");
    expect(exponential).toBe("kept");
    expect(decimal).toBe("decimal");
    expect(state.length).toBe(1);
  });

  test("Reconcile array shrink clears tracked indices on the override path", () => {
    // a prior setter write installs STORE_OVERRIDE, routing reconcile through
    // applyStateSlow — shrink must clear removed indices there too
    const [state, setState] = createStore<{ id: number }[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
    setState(s => {
      s[3] = { id: 4 };
    });
    flush();
    let last: { id: number } | undefined;
    createRoot(() => {
      createEffect(
        () => state[3],
        v => {
          last = v;
        }
      );
    });
    flush();
    expect(last).toEqual({ id: 4 });

    setState(reconcile([{ id: 1 }], "id"));
    flush();

    expect(state.length).toBe(1);
    expect(last).toBe(undefined);
    expect(state[3]).toBe(undefined);
  });
  test("Reconcile swaps a property whose value is another store's proxy", () => {
    type Row = { id: number; name: string };
    const [rowA] = createStore<Row>({ id: 1, name: "a" });
    const [rowB] = createStore<Row>({ id: 2, name: "b" });

    // rows rendered somewhere -> live tracked nodes
    let effA: Row | undefined;
    let effB: Row | undefined;
    createRoot(() => {
      createEffect(
        () => ({ id: rowA.id, name: rowA.name }),
        v => {
          effA = v;
        }
      );
      createEffect(
        () => ({ id: rowB.id, name: rowB.name }),
        v => {
          effB = v;
        }
      );
    });
    flush();
    expect(effA).toEqual({ id: 1, name: "a" });
    expect(effB).toEqual({ id: 2, name: "b" });

    const [state, setState] = createStore<{ selected: Row }>({ selected: rowA });
    let selectedName: string | undefined;
    createRoot(() => {
      createEffect(
        () => state.selected.name,
        v => {
          selectedName = v;
        }
      );
    });
    flush();
    expect(selectedName).toBe("a");

    setState(reconcile({ selected: rowB }, "id"));
    flush();

    expect(state.selected.id).toBe(2);
    expect(state.selected.name).toBe("b");
    expect(selectedName).toBe("b");
  });

  test("Reconcile reorders an array whose items are store proxies", () => {
    type Row = { id: number; name: string };
    const [rowA] = createStore<Row>({ id: 1, name: "a" });
    const [rowB] = createStore<Row>({ id: 2, name: "b" });
    let names: string | undefined;
    createRoot(() => {
      // rows rendered somewhere -> live tracked nodes
      createEffect(
        () => rowA.name + rowB.name,
        () => {}
      );
    });
    flush();

    const [list, setList] = createStore<Row[]>([rowA, rowB]);
    createRoot(() => {
      createEffect(
        () => list.map(r => r?.name).join(","),
        v => {
          names = v;
        }
      );
    });
    flush();
    expect(names).toBe("a,b");

    setList(reconcile([rowB, rowA], "id"));
    flush();

    expect(names).toBe("b,a");
    expect(list[0].id).toBe(2);
    expect(list[1].id).toBe(1);
    expect(snapshot(list)).toEqual([
      { id: 2, name: "b" },
      { id: 1, name: "a" }
    ]);
  });

  test("Reconcile swaps keyless store-proxy property values", () => {
    type Row = { name: string };
    const [rowA] = createStore<Row>({ name: "a" });
    const [rowB] = createStore<Row>({ name: "b" });
    createRoot(() => {
      createEffect(
        () => rowA.name + rowB.name,
        () => {}
      );
    });
    flush();

    const [state, setState] = createStore<{ selected: Row }>({ selected: rowA });
    let selectedName: string | undefined;
    createRoot(() => {
      createEffect(
        () => state.selected.name,
        v => {
          selectedName = v;
        }
      );
    });
    flush();
    expect(selectedName).toBe("a");

    setState(reconcile({ selected: rowB }, "id"));
    flush();

    expect(state.selected.name).toBe("b");
    expect(selectedName).toBe("b");
  });
});

describe("reconcile with symbol-keyed properties", () => {
  const META = Symbol("meta");

  test("notifies an effect tracking a symbol-keyed property", () => {
    const [state, setState] = createStore<Record<PropertyKey, any>>({ id: 1, [META]: "old" });
    let seen: any;
    createRoot(() => {
      createEffect(
        () => state[META],
        v => {
          seen = v;
        }
      );
    });
    flush();
    expect(seen).toBe("old");

    setState(reconcile({ id: 1, [META]: "new" }, "id"));
    flush();
    expect(state[META]).toBe("new"); // value reachable, not shadowed by a stale node
    expect(seen).toBe("new"); // subscriber notified
  });

  test("string control updates through the identical path", () => {
    const [state, setState] = createStore<Record<PropertyKey, any>>({ id: 1, meta: "old" });
    let seen: any;
    createRoot(() => {
      createEffect(
        () => state.meta,
        v => {
          seen = v;
        }
      );
    });
    flush();

    setState(reconcile({ id: 1, meta: "new" }, "id"));
    flush();
    expect(state.meta).toBe("new");
    expect(seen).toBe("new");
  });

  test("string and symbol keys on the same store both update", () => {
    const [state, setState] = createStore<Record<PropertyKey, any>>({
      id: 1,
      label: "old",
      [META]: "old"
    });
    let sawLabel: any, sawMeta: any;
    createRoot(() => {
      createEffect(
        () => state.label,
        v => {
          sawLabel = v;
        }
      );
      createEffect(
        () => state[META],
        v => {
          sawMeta = v;
        }
      );
    });
    flush();

    setState(reconcile({ id: 1, label: "new", [META]: "new" }, "id"));
    flush();
    expect(sawLabel).toBe("new");
    expect(sawMeta).toBe("new");
  });

  test("a symbol key removed by reconcile notifies as undefined", () => {
    const [state, setState] = createStore<Record<PropertyKey, any>>({ id: 1, [META]: "old" });
    let seen: any = "unset";
    createRoot(() => {
      createEffect(
        () => state[META],
        v => {
          seen = v;
        }
      );
    });
    flush();

    setState(reconcile({ id: 1 }, "id"));
    flush();
    expect(state[META]).toBeUndefined();
    expect(seen).toBeUndefined();
  });

  test("a symbol `in` check updates when reconcile adds the key", () => {
    const [state, setState] = createStore<Record<PropertyKey, any>>({ id: 1 });
    let has: boolean | undefined;
    createRoot(() => {
      createEffect(
        () => META in state,
        v => {
          has = v;
        }
      );
    });
    flush();
    expect(has).toBe(false);

    setState(reconcile({ id: 1, [META]: "added" }, "id"));
    flush();
    expect(has).toBe(true);
  });

  test("perf invariant: symbol-record mark is set while tracked and cleared once unobserved", async () => {
    // Guards the fast-path optimization: only records that currently hold a
    // user symbol node are enumerated for symbols on reconcile. Asserts the
    // internal mark rather than behavior (the mark is invisible to behavior).
    const { symbolKeyedRecords, $TARGET, STORE_NODE } = await import("../../src/store/store.js");
    const [store] = createStore<Record<PropertyKey, any>>({ id: 1, [META]: "x" });
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => store[META],
        () => {}
      );
    });
    flush();
    const nodes = (store as any)[$TARGET][STORE_NODE];
    expect(symbolKeyedRecords.has(nodes)).toBe(true);
    dispose();
    flush();
    expect(symbolKeyedRecords.has(nodes)).toBe(false); // no monotonic leak
  });

  test("nested symbol-keyed value reconciles", () => {
    const [state, setState] = createStore<Record<PropertyKey, any>>({
      id: 1,
      inner: { [META]: "old" }
    });
    let seen: any;
    createRoot(() => {
      createEffect(
        () => state.inner[META],
        v => {
          seen = v;
        }
      );
    });
    flush();

    setState(reconcile({ id: 1, inner: { [META]: "new" } }, "id"));
    flush();
    expect(state.inner[META]).toBe("new");
    expect(seen).toBe("new");
  });
});
// type tests

// reconcile
() => {
  const [state, setState] = createStore<{ data: number; missing: string; partial?: { v: number } }>(
    {
      data: 2,
      missing: "soon"
    }
  );
  // @ts-expect-error should not be able to reconcile partial type
  setState(reconcile({ data: 5 }));
};
