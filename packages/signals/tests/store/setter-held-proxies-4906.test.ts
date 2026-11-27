import { createStore, flush, reconcile, snapshot } from "../../src/index.js";

// Found by running random store programs on both engines (#4906): a user's
// setter that stores a store proxy, or a value built from the store's own
// rows, keeps the proxy's identity and reads it live (CS-R2, CS-R3).
const row = (id: number) => ({ id, v: 0, sub: { x: 0 } });

function setup() {
  const [A, setA] = createStore<any>({ n: 0, o: { a: 1 }, list: [row(1), row(2), row(3)] });
  const [D] = createStore<any>(() => ({ n: A.n, o: A.o, list: A.list }), { n: 0 });
  const [E, setE] = createStore<any>((d: any) => void (d.n = A.n), {
    n: 0,
    o: { a: 5 },
    list: [row(7), row(8)],
    ref: null
  });
  const [B, setB] = createStore<any>({ ref: null, list: [] });
  flush();
  D.n;
  E.n;
  flush();
  return { A, setA, D, E, setE, B, setB };
}

describe("a setter storing a store proxy", () => {
  it("a plain store holding a derived store snapshots the derived store's answer", () => {
    const { D, B, setB } = setup();
    setB(d => void (d.ref = D));
    flush();
    expect(B.ref).toBe(D);
    expect(snapshot(B).ref).toEqual(snapshot(D));
    expect(snapshot(B).ref.list.length).toBe(3);
  });

  it("a plain store holding a derived store's row snapshots the row", () => {
    const { D, B, setB } = setup();
    setB(d => void d.list.push(D.list[0]));
    flush();
    expect(B.list[0].id).toBe(1);
    expect(snapshot(B).list).toEqual([row(1)]);
  });

  it("a derived store holding another derived store reads it live", () => {
    const { setA, D, E, setE } = setup();
    setE(d => void (d.ref = D));
    flush();
    expect(E.ref.o.a).toBe(1);
    expect(snapshot(E).ref).toEqual(snapshot(D));
    setE(d => void (d.o = D.o));
    flush();
    expect(E.o.a).toBe(1);
    expect(snapshot(E).o).toEqual({ a: 1 });
    setA(d => void (d.o.a = 2));
    flush();
    expect(E.o.a).toBe(2);
  });
});

describe("a setter value built from the store's own rows", () => {
  it("an assigned filtered list keeps its rows", () => {
    const { E, setE } = setup();
    const r0 = E.list[0];
    const r1 = E.list[1];
    setE(d => void (d.list = d.list.filter((r: any) => r.id !== 99)));
    flush();
    expect(E.list[0]).toBe(r0);
    expect(E.list[1]).toBe(r1);
  });

  it("a returned value keeps its rows, and the snapshot follows later writes", () => {
    const { E, setE } = setup();
    const r0 = E.list[0];
    setE(d => ({ ...d, list: [d.list[1], d.list[0]] }));
    flush();
    expect(E.list[1]).toBe(r0);
    expect(snapshot(E).list.map((r: any) => r.id)).toEqual([8, 7]);
    setE(d => void (d.list[0].v = 4));
    flush();
    expect(E.list[0].v).toBe(4);
    expect(snapshot(E).list.map((r: any) => r.v)).toEqual([4, 0]);
  });
});

describe("reconcile on a value that is not a store", () => {
  it("throws for a shallow store's raw list", () => {
    const [C, setC] = createStore<any>({ list: [row(1)] }, { shallow: true } as any);
    expect(() => setC(d => void reconcile([row(2)], "id")(d.list))).toThrow(
      "reconcile target is not a store proxy"
    );
    flush();
    expect(C.list.length).toBe(1);
  });
  it("throws for null", () => {
    expect(() => reconcile([row(2)], "id")(null as any)).toThrow("Cannot reconcile null");
  });
});
