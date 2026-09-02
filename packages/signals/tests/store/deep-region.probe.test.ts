import { describe, expect, it } from "vitest";
import { createRoot, createStore, flush, region } from "../../src/index.js";

/** DEEP regions (the emitter's `, 1` flag) under the ENVELOPE CONTRACT:
 * dk bumps are per-record with no subscription-side deep coverage — the
 * WRITE bubbles: bumpDeep walks the parent chain and bumps any ancestor
 * flagged as a deep-region root (refcounted `rdp`, live-gated by a module
 * counter). One dk subscription per region regardless of read depth;
 * over-delivery on unrelated deep writes is a no-op at the commit's
 * baseline compares. */
describe("deep region delivery (dbmon shape)", () => {
  function mount() {
    const [s, set] = createRoot(() =>
      createStore({
        rows: [
          { id: 1, lastSample: { nbQueries: 5, topFiveQueries: [{ elapsed: 1 }, { elapsed: 2 }] } }
        ]
      })
    );
    const row = s.rows[0];
    const seen: string[] = [];
    createRoot(() => {
      region(
        row,
        (t: any, u: any, d: any) => {
          const w0 = d(u, "lastSample");
          const w1 = d(w0, "topFiveQueries");
          t.s = `${w0?.nbQueries}:${d(w1, "0")?.elapsed}:${d(w1, "1")?.elapsed}`;
        },
        (t: any) => {
          seen.push(t.s);
        },
        1
      );
    });
    flush();
    return { set, seen };
  }

  it("delivers deep in-place writes (two levels down)", () => {
    const { set, seen } = mount();
    set(d => {
      d.rows[0].lastSample.topFiveQueries[0].elapsed = 99;
    });
    flush();
    expect(seen.at(-1)).toBe("5:99:2");
  });

  it("delivers mid-level in-place writes", () => {
    const { set, seen } = mount();
    set(d => {
      d.rows[0].lastSample.nbQueries = 7;
    });
    flush();
    expect(seen.at(-1)).toBe("7:1:2");
  });

  it("delivers wholesale child replacement (dbmon's tick shape)", () => {
    const { set, seen } = mount();
    set(d => {
      d.rows[0].lastSample = { nbQueries: 9, topFiveQueries: [{ elapsed: 10 }, { elapsed: 20 }] };
    });
    flush();
    expect(seen.at(-1)).toBe("9:10:20");
  });

  it("deep write into a REPLACED child delivers (pure-phase re-subscription)", () => {
    const { set, seen } = mount();
    set(d => {
      d.rows[0].lastSample = { nbQueries: 9, topFiveQueries: [{ elapsed: 10 }, { elapsed: 20 }] };
    });
    flush();
    set(d => {
      d.rows[0].lastSample.topFiveQueries[1].elapsed = 42;
    });
    flush();
    expect(seen.at(-1)).toBe("9:10:42");
  });

  it("deep DELETIONS demote to the classic fallback and deliver", () => {
    // Overlay backings retain deleted keys in raw (t.del is proxy-only), so
    // a deletion demotes the region — the fallback's proxy reads see it.
    const { set, seen } = mount();
    set(d => {
      delete (d.rows[0].lastSample as any).nbQueries;
    });
    flush();
    expect(seen.at(-1)).toBe("undefined:1:2");
    // And the fallback keeps delivering subsequent writes.
    set(d => {
      d.rows[0].lastSample.topFiveQueries[0].elapsed = 77;
    });
    flush();
    expect(seen.at(-1)).toBe("undefined:77:2");
  });

  it("delivers deep array TRUNCATION", () => {
    const { set, seen } = mount();
    set(d => {
      d.rows[0].lastSample.topFiveQueries.length = 1;
    });
    flush();
    expect(seen.at(-1)).toBe("5:1:undefined");
  });

  it("delivers SYMBOL-keyed deep writes when read through the envelope", () => {
    const SYM = Symbol("mark");
    const [s, set] = createRoot(() => createStore({ row: { child: { [SYM]: 1, v: "a" } } } as any));
    const seen: any[] = [];
    createRoot(() => {
      region(
        s.row,
        (t: any, u: any, d: any) => {
          t.m = d(u, "child")?.[SYM];
        },
        (t: any) => {
          seen.push(t.m);
        },
        1
      );
    });
    flush();
    set((d: any) => {
      d.row.child[SYM] = 2;
    });
    flush();
    expect(seen.at(-1)).toBe(2);
  });

  it("unchanged deep values do not redeliver", () => {
    const { set, seen } = mount();
    const before = seen.length;
    set(d => {
      d.rows[0].lastSample.nbQueries = 5; // same value
    });
    flush();
    expect(seen.length).toBe(before);
  });

  it("owner disposal releases the deep-region live gate", () => {
    const [s, set] = createRoot(() =>
      createStore({ row: { a: { b: 1 } }, other: { c: { d: 1 } } })
    );
    const seen: number[] = [];
    const dispose = createRoot(d => {
      region(
        s.row,
        (t: any, u: any, d: any) => {
          t.b = d(u, "a")?.b;
        },
        (t: any) => {
          seen.push(t.b);
        },
        1
      );
      return d;
    });
    flush();
    dispose();
    set(d => {
      d.row.a.b = 2;
    });
    flush();
    expect(seen).toEqual([1]);
  });
});
