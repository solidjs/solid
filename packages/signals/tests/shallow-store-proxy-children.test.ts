/**
 * #2932: a shallow store ingesting another store's proxy sticky-marked that
 * proxy as a raw value. The mark is global — wrap() serves raw-marked values
 * verbatim through EVERY store — so a downstream deep store captured the
 * upstream proxy instead of wrapping it in its own family, and its writes
 * landed in the upstream store's override layer: writing the last store in a
 * derived chain (s0 -> s1(shallow) -> s2) updated all three.
 *
 * Store proxies are already tracked elsewhere; the shallow boundary now
 * passes them through unmarked (slot semantics unchanged: replaced by
 * reference), so every store wraps them in its own family and write
 * isolation matches the shallow:false chain.
 */
import { createRoot, createStore, flush } from "../src/index.js";
import { $TARGET } from "../src/store/store.js";

function chain(shallow: boolean) {
  const base = [
    { id: 1, name: "aaa" },
    { id: 2, name: "bbb" },
    { id: 3, name: "ccc" }
  ];
  let s0: any, ss0: any, s1: any, s2: any, ss2: any;
  createRoot(() => {
    [s0, ss0] = createStore(() => ({ items: base }), {} as any);
    [s1] = createStore((_s: any) => ({ items: s0.items }), {} as any, { shallow } as any);
    [s2, ss2] = createStore(() => ({ items: s1.items }), {} as any);
  });
  flush();
  return { base, s0, ss0, s1, s2, ss2 };
}

describe("#2932: derived chain through a shallow store", () => {
  test("write to the last store stays in the last store (shallow middle)", () => {
    const { base, s0, s1, s2, ss2 } = chain(true);
    ss2((s: any) => {
      s.items[0].name = "EEE2";
    });
    flush();
    expect(s2.items[0].name).toBe("EEE2");
    expect(s1.items[0].name).toBe("aaa");
    expect(s0.items[0].name).toBe("aaa");
    expect(base[0].name).toBe("aaa");
  });

  test("parity with the shallow:false control", () => {
    const a = chain(true);
    const b = chain(false);
    for (const { ss2 } of [a, b]) {
      ss2((s: any) => {
        s.items[0].name = "EEE2";
      });
    }
    flush();
    for (const { s0, s1, s2 } of [a, b]) {
      expect([s0.items[0].name, s1.items[0].name, s2.items[0].name]).toEqual([
        "aaa",
        "aaa",
        "EEE2"
      ]);
    }
  });

  test("each level serves its own proxies; upstream writes stay fresh through the chain", () => {
    const { s0, ss0, s1, s2 } = chain(true);
    expect(s1.items === s0.items).toBe(false);
    expect(s2.items === s1.items).toBe(false);
    expect((s1.items as any)[$TARGET]).toBeDefined();

    // Upstream (derived) writes land in s0's override layer and must be
    // visible through the shallow pass-through and the deep tail alike.
    ss0((s: any) => {
      s.items[0].name = "ZZZ";
    });
    flush();
    expect(s0.items[0].name).toBe("ZZZ");
    expect(s1.items[0].name).toBe("ZZZ");
    expect(s2.items[0].name).toBe("ZZZ");
  });
});

describe("#2932: plain shallow store holding another store's proxy", () => {
  test("set-trap ingest passes through without raw-marking (owner's wrapping intact)", () => {
    let deep: any, setDeep: any, sh: any, setSh: any;
    createRoot(() => {
      [deep, setDeep] = createStore({ rows: [{ id: 1, name: "aaa" }] });
      [sh, setSh] = createStore<any>({ list: null }, { shallow: true } as any);
    });
    setSh((s: any) => {
      s.list = deep.rows;
    });
    flush();

    // The old sticky mark poisoned wrap() for the owner too — deep's own
    // reads would have served the raw. Both must keep seeing live values.
    setDeep((s: any) => {
      s.rows[0].name = "ZZZ";
    });
    flush();
    expect(deep.rows[0].name).toBe("ZZZ");
    expect(sh.list[0].name).toBe("ZZZ");
  });

  test("seed ingest passes through without raw-marking", () => {
    let deep: any, setDeep: any, sh: any;
    createRoot(() => {
      [deep, setDeep] = createStore({ rows: [{ id: 1, name: "aaa" }] });
      [sh] = createStore<any>({ list: deep.rows }, { shallow: true } as any);
    });
    flush();
    setDeep((s: any) => {
      s.rows[0].name = "ZZZ";
    });
    flush();
    expect(deep.rows[0].name).toBe("ZZZ");
    expect(sh.list[0].name).toBe("ZZZ");
  });

  test("plain records still get the shallow raw treatment", () => {
    let sh: any, setSh: any;
    createRoot(() => {
      [sh, setSh] = createStore<any>({ rec: null }, { shallow: true } as any);
    });
    const rec = { id: 1, name: "aaa" };
    setSh((s: any) => {
      s.rec = rec;
    });
    flush();
    // Raw leaf: served as-is, replaced by reference.
    expect(sh.rec).toBe(rec);
  });
});
