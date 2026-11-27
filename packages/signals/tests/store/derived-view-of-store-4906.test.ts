import {
  action,
  affects,
  createOptimisticStore,
  createProjection,
  createStore,
  flush,
  isPending,
  reconcile,
  snapshot
} from "../../src/index.js";

// A derived store's view of another store's objects (ruled 2026-11-18,
// #4906): rows follow the source row (CS-R2), the derive's answer replaces
// what a user wrote on the view (CS-R4), and a user's write to a viewed
// list makes the list the view's own.
const row = (id: number) => ({ id, v: 0 });

function setup() {
  const [A, setA] = createStore<any>({ n: 0, o: { a: 1 }, list: [row(1), row(2), row(3)] });
  const [D, setD] = createStore<any>(() => ({ n: A.n, o: A.o, list: A.list }), { n: 0 });
  flush();
  D.n;
  flush();
  return { A, setA, D, setD };
}
const ids = (l: any) => l.map((r: any) => r?.id);

describe("a derived store's view of another store", () => {
  it("a row follows the source row when the source reorders", () => {
    const { setA, D } = setup();
    const d0 = D.list[0];
    setA(d => void d.list.reverse());
    flush();
    expect(ids(D.list)).toEqual([3, 2, 1]);
    expect(D.list[2]).toBe(d0);
    expect(d0.id).toBe(1);
    expect(snapshot(D).list.map((r: any) => r.id)).toEqual([3, 2, 1]);
  });

  it("the derive's next answer replaces a user's write on the view", () => {
    const { A, setA, D, setD } = setup();
    setD(d => void (d.o.a = 9));
    flush();
    expect(D.o.a).toBe(9);
    expect(A.o.a).toBe(1);
    setA(d => void (d.n = 1));
    flush();
    expect(D.n).toBe(1);
    expect(D.o.a).toBe(1);
    // The view still follows the source.
    setA(d => void (d.o.a = 2));
    flush();
    expect(D.o.a).toBe(2);
  });

  it("a user's write to a viewed list makes the list the view's own", () => {
    const { A, setA, D, setD } = setup();
    setD(d => void d.list.push({ id: 50, v: 0 }));
    flush();
    expect(ids(D.list)).toEqual([1, 2, 3, 50]);
    expect(ids(A.list)).toEqual([1, 2, 3]);
    setA(d => void d.list.pop());
    flush();
    expect(ids(D.list)).toEqual([1, 2, 3, 50]);
    expect(D.list.length).toBe(4);
    // Its rows are still the source rows' views.
    setA(d => void (d.list[0].v = 5));
    flush();
    expect(D.list[0].v).toBe(5);
    // The derive's next answer is the source list again.
    setA(d => void (d.n = 1));
    flush();
    expect(ids(D.list)).toEqual([1, 2]);
  });

  // A held write to a viewed row, read during its hold, stays the view's.
  for (const read of ["nothing", "the source", "the view"])
    it(`an action's keyed write to a viewed row stays in the view after reading ${read}`, async () => {
      const [person] = createStore({ id: 1, name: "Alice" });
      const [view, setView] = createStore<any>(() => ({ rows: [person] }));
      flush();
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      const done = action(function* () {
        setView((d: any) => void reconcile([{ id: 1, name: "Bob" }], "id")(d.rows));
        yield gate;
      })();
      flush();
      if (read === "the source") person.name;
      if (read === "the view") view.rows[0].name;
      release();
      await done;
      flush();
      expect(person.name).toBe("Alice");
      expect(view.rows[0].name).toBe("Bob");
    });

  it("a shallow derived store's seed that holds a store is its view of it", () => {
    const [person] = createStore({ name: "Alice" });
    const [view, setView] = createStore<any>(() => ({ row: person }), { row: person }, {
      shallow: true
    } as any);
    flush();
    expect(view.row).not.toBe(person);
    expect(view.row.name).toBe("Alice");
    setView((d: any) => void (d.row.name = "Bob"));
    flush();
    expect(view.row.name).toBe("Bob");
    expect(person.name).toBe("Alice");
  });

  it("a marked view is pending at its first untracked read; its source is not", async () => {
    const [source] = createStore({ address: { city: "Paris" } });
    const [view] = createStore<any>(() => source);
    flush();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const done = action(function* () {
      affects(view);
      yield gate;
    })();
    flush();
    expect(isPending(() => source.address.city)).toBe(false);
    expect(isPending(() => view.address.city)).toBe(true);
    release();
    await done;
    flush();
    expect(isPending(() => view.address.city)).toBe(false);
  });

  // No store owns its objects from the outside: a plain store's setter
  // writes a `createStore(fn)` row it holds, and the write is the view's.
  // A projection owns its proxies, and an optimistic store's writes are its
  // actions' guesses: neither is written through another store.
  it("a plain store's setter writes a derived store's row it holds", () => {
    const [person] = createStore({ name: "Alice" });
    const [view] = createStore<any>(() => ({ row: person }));
    flush();
    const [card, setCard] = createStore<any>({ row: view.row });
    expect(card.row).toBe(view.row);
    setCard(d => void (d.row.name = "Bob"));
    flush();
    expect(card.row.name).toBe("Bob");
    expect(view.row.name).toBe("Bob");
    expect(person.name).toBe("Alice");
  });

  it("a projection's row is not written through another store", () => {
    const view = createProjection<any>(() => ({ row: { name: "Own" } }), {});
    flush();
    const [card, setCard] = createStore<any>({ row: view.row });
    setCard(d => void (d.row.name = "Bob"));
    flush();
    expect(card.row.name).toBe("Own");
    expect(view.row.name).toBe("Own");
  });

  it("an optimistic store's row is not written through another store", () => {
    const [view] = createOptimisticStore<any>(() => ({ row: { name: "Own" } }), {});
    flush();
    const [card, setCard] = createStore<any>({ row: view.row });
    setCard(d => void (d.row.name = "Bob"));
    flush();
    expect(card.row.name).toBe("Own");
    expect(view.row.name).toBe("Own");
  });
});
