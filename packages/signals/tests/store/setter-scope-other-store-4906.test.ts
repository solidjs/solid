// A setter's draft is its own store: the read side of another plain store
// stays read-only while it is open (#4906).
import { describe, expect, test } from "vitest";
import { createStore, flush } from "../../src/index.js";

describe("a plain setter's draft is its own store", () => {
  test("an unrelated plain store is not writable inside another store's setter", () => {
    const [a, setA] = createStore({ count: 0, n: { c: 0 } });
    const [b] = createStore({ count: 0, n: { c: 0 }, l: [{ c: 0 }] });
    setA(d => {
      d.count++;
      d.n.c++;
      (b as any).count++;
      (b as any).n.c++;
      (b as any).l[0].c++;
      (b as any).l.push({ c: 9 });
    });
    flush();
    expect([a.count, a.n.c]).toEqual([1, 1]);
    expect([b.count, b.n.c, b.l[0].c, b.l.length]).toEqual([0, 0, 0, 1]);
  });

  test("a row captured from the store is written inside its own setter", () => {
    const [a, setA] = createStore({ n: { c: 0 } });
    const row = a.n;
    setA(() => {
      (row as any).c = 5;
    });
    flush();
    expect(a.n.c).toBe(5);
  });

  test("another store's setter closing inside leaves that store read-only again", () => {
    const [a, setA] = createStore({ c: 0 });
    const [b, setB] = createStore({ c: 0, n: { c: 0 } });
    setA(d => {
      d.c = 1;
      setB(e => {
        e.c = 1;
      });
      (b as any).n.c = 7;
      d.c = 2;
    });
    flush();
    expect([a.c, b.c, b.n.c]).toEqual([2, 1, 0]);
  });

  test("a raw two stores hold is written through either store's draft (CS-R2)", () => {
    const raw = { c: 0 };
    const [a] = createStore({ r: raw });
    const [b, setB] = createStore({ r: raw });
    expect(a.r.c).toBe(0);
    setB(d => {
      d.r.c = 1;
    });
    flush();
    expect([a.r.c, b.r.c]).toEqual([1, 1]);
  });

  test("a store's row placed in another store is written through the holder's draft (CS-R2)", () => {
    const [p] = createStore({ n: { c: 0 } });
    const [b, setB] = createStore<any>({});
    setB(d => {
      d.r = p.n;
    });
    flush();
    setB(d => {
      d.r.c = 1;
    });
    flush();
    expect([p.n.c, b.r.c]).toEqual([1, 1]);
  });
});
