import { createStore, flush, snapshot } from "../../src/index.js";

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
});
