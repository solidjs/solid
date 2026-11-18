// #4906 review (GabbeV, and the model probe): a store held by another store,
// a user setter's returned value, a seedless derive answering a list, and
// two actions adding different keys to a record.
import { describe, expect, test } from "vitest";
import {
  action,
  affects,
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  isPending,
  mapArray,
  refresh,
  snapshot
} from "../../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("a plain store holding another store (CS-R3, CS-R4, CS-R5)", () => {
  test("every read of the holder agrees; the source and a sibling holder are untouched", () => {
    const [person] = createStore({ name: "Alice" });
    const [a, editA] = createStore({ row: person });
    const [b] = createStore({ row: person });
    editA(d => {
      d.row.name = "Bob";
    });
    flush();
    expect(a.row.name).toBe("Bob");
    expect(snapshot(a).row.name).toBe("Bob");
    expect(deep(a).row.name).toBe("Bob");
    expect(b.row.name).toBe("Alice");
    expect(person.name).toBe("Alice");
  });

  test("a store pushed in later is held the same way", () => {
    const [person] = createStore({ name: "Alice" });
    const [people, edit] = createStore<{ name: string }[]>([]);
    edit(d => {
      d.push(person);
    });
    flush();
    edit(d => {
      d[0].name = "Bob";
    });
    flush();
    expect(people[0].name).toBe("Bob");
    expect(person.name).toBe("Alice");
  });

  test("a tracked reader of the held row follows the source until the holder writes the key", () => {
    const [person, setPerson] = createStore({ name: "Alice", tags: ["a"] });
    const [list, setList] = createStore({ people: [person] });
    const seen: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => `${list.people[0].name}/${list.people[0].tags.length}`,
        v => void seen.push(v)
      );
    });
    flush();
    setPerson(d => {
      d.name = "Carol";
      d.tags.push("b");
    });
    flush();
    setList(d => {
      d.people[0].name = "Bob";
    });
    flush();
    setPerson(d => {
      d.name = "Dave";
      d.tags.push("c");
    });
    flush();
    expect(seen).toEqual(["Alice/1", "Carol/2", "Bob/2", "Bob/3"]);
    expect(snapshot(list)).toEqual({ people: [{ name: "Bob", tags: ["a", "b", "c"] }] });
    expect(snapshot(person)).toEqual({ name: "Dave", tags: ["a", "b", "c"] });
  });

  test("the holder's own row of it stays one row when aliased", () => {
    const [person] = createStore({ name: "Alice" });
    const [list, setList] = createStore({ people: [person] });
    setList(d => {
      d.people.push(d.people[0]);
    });
    flush();
    expect(list.people[1]).toBe(list.people[0]);
  });

  test("a shallow store's keyed rows and its index agree", () => {
    const [person] = createStore({ id: 2, name: "Alice" });
    const [rows, edit] = createStore<{ id: number; name: string }[]>([{ id: 1, name: "first" }], {
      shallow: true
    });
    let screen: string[] = [];
    createRoot(() => {
      const mapped = createMemo(
        mapArray(
          () => rows,
          row => () => row().name,
          { keyed: (row: { id: number }) => row.id } as any
        )
      );
      createRenderEffect(
        () => (mapped() as any[]).map(r => r()),
        names => void (screen = names)
      );
    });
    flush();
    edit(() => [person]);
    flush();
    expect(screen).toEqual(["Alice"]);
    edit(d => {
      d[0].name = "Bob";
    });
    flush();
    expect(rows[0].name).toBe("Bob");
    expect(screen).toEqual(["Bob"]);
    expect(person.name).toBe("Alice");
  });

  test("affects(list) marks the list's row of it, not the source or a sibling holder", async () => {
    let run!: () => Promise<void>;
    const flags: boolean[][] = [];
    createRoot(() => {
      const [person] = createStore({ name: "Alice" });
      const [list] = createStore({ people: [person] });
      const [other] = createStore({ people: [person] });
      const row = list.people[0];
      const sibling = other.people[0];
      createRenderEffect(
        () => [
          isPending(() => person.name),
          isPending(() => row.name),
          isPending(() => sibling.name)
        ],
        f => void flags.push(f)
      );
      run = action(function* () {
        affects(list);
        yield new Promise(r => setTimeout(r, 20));
      }) as any;
    });
    flush();
    const p = run();
    await settle();
    expect(flags.at(-1)).toEqual([false, true, false]);
    await p;
    await settle();
    expect(flags.at(-1)).toEqual([false, false, false]);
  });
});

test("a function-initialized store keeps two references to one store as one row", () => {
  const [person] = createStore({ name: "Alice" });
  const [view, edit] = createStore<any>(() => ({ left: person, right: person }));
  flush();
  expect(view.left).toBe(view.right);
  edit((d: any) => {
    d.left.name = "Bob";
  });
  flush();
  expect(view.right.name).toBe("Bob");
  expect(person.name).toBe("Alice");
});

test.each([true, false])(
  "a user setter's returned value is a shallow diff (function-initialized: %s)",
  fn => {
    const initial = { rows: [{ id: 1, name: "Alice" }] };
    const [list, edit] = fn ? createStore<any>(() => initial) : createStore<any>(initial);
    flush();
    const captured = list.rows[0];
    edit(() => ({ rows: [{ id: 1, name: "Bob" }] }));
    flush();
    expect(list.rows[0]).not.toBe(captured);
    expect(list.rows[0].name).toBe("Bob");
    expect(captured.name).toBe("Alice");
  }
);

describe("a seedless derive answering a list", () => {
  test.each([
    ["createProjection", (f: any) => createProjection(f)],
    ["createStore", (f: any) => createStore(f)[0]],
    ["createOptimisticStore", (f: any) => createOptimisticStore(f)[0]]
  ] as const)("%s: the store is a list", (_, make) => {
    const [n, setN] = createSignal(2);
    let s: any;
    const seen: number[] = [];
    createRoot(() => {
      s = (make as any)(() => Array.from({ length: n() }, (_, i) => ({ id: i })));
      createRenderEffect(
        () => s.length,
        (l: number) => void seen.push(l)
      );
    });
    flush();
    const first = s[0];
    expect(snapshot(s)).toEqual([{ id: 0 }, { id: 1 }]);
    expect(s.map((r: any) => r.id)).toEqual([0, 1]);
    setN(3);
    flush();
    setN(1);
    flush();
    expect(seen).toEqual([2, 3, 1]);
    expect(Object.keys(s)).toEqual(["0"]);
    expect(snapshot(s)).toEqual([{ id: 0 }]);
    expect(s[0]).toBe(first);
  });

  test("a guessed row the server confirms keeps its proxy (Q-D)", async () => {
    let server = [{ id: 1 }, { id: 2 }];
    const land: (() => void)[] = [];
    let list!: { id: number }[], guess!: (fn: (d: { id: number }[]) => void) => void;
    let mounts = 0;
    createRoot(() => {
      [list, guess] = createOptimisticStore<any>(
        () => new Promise<any>(r => land.push(() => r(structuredClone(server))))
      ) as any;
      const rows = mapArray(
        () => list,
        row => (mounts++, row.id)
      );
      createRenderEffect(
        () => rows().join(),
        () => {}
      );
    });
    flush();
    land.shift()!();
    await settle();
    let api!: () => void;
    const add = action(function* () {
      guess(d => void d.push({ id: 3 }));
      yield new Promise<void>(r => (api = r));
      server = [...server, { id: 3 }];
      refresh(list as any);
    });
    const p = add();
    await settle();
    const guessed = list[2];
    mounts = 0;
    api();
    await settle();
    land.shift()!();
    await p;
    await settle();
    expect(list[2]).toBe(guessed);
    expect(mounts).toBe(0);
  });
});

test.each([false, true])(
  "two actions adding different keys to a record settle apart (D-33; a reader enumerates: %s)",
  async enumerates => {
    let o!: Record<string, number>, guess!: (fn: (d: Record<string, number>) => void) => void;
    let aCommitted = false;
    const [done, setDone] = createSignal(false);
    createRoot(() => {
      [o, guess] = createOptimisticStore<Record<string, number>>({ a: 0 });
      if (enumerates)
        createRenderEffect(
          () => Object.keys(o).join(),
          () => {}
        );
      createRenderEffect(done, v => void (aCommitted = v));
    });
    flush();
    let endA!: () => void, endB!: () => void;
    const A = action(function* () {
      guess(d => void (d.x = 1));
      yield new Promise<void>(r => (endA = r));
      setDone(true);
    });
    const B = action(function* () {
      guess(d => void (d.y = 2));
      yield new Promise<void>(r => (endB = r));
    });
    const pA = A();
    await settle();
    const pB = B();
    await settle();
    endA();
    await pA;
    await settle();
    expect({ aCommitted, x: "x" in o, y: "y" in o }).toEqual({
      aCommitted: true,
      x: false,
      y: true
    });
    endB();
    await pB;
    await settle();
    expect(Object.keys(o)).toEqual(["a"]);
  }
);
