import { describe, expect, it } from "vitest";
import { createRoot, createStore, flush, region } from "../../src/index.js";

/** DEEP regions (the emitter's `, 1` flag): dk bumps are per-record with no
 * subscription-side deep coverage — instead the WRITE bubbles: bumpDeep
 * walks the parent chain and bumps any ancestor flagged as a deep-region
 * root (refcounted `rdp`, live-gated by a module counter). One dk
 * subscription per region regardless of read depth; over-delivery on
 * unrelated deep writes is a no-op at the body's baseline compares. */
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
        null,
        (raw: any) => {
          seen.push(
            `${raw.lastSample.nbQueries}:${raw.lastSample.topFiveQueries[0].elapsed}:${raw.lastSample.topFiveQueries[1].elapsed}`
          );
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

  it("owner disposal releases the deep-region live gate", () => {
    const [s, set] = createRoot(() =>
      createStore({ row: { a: { b: 1 } }, other: { c: { d: 1 } } })
    );
    const seen: number[] = [];
    const dispose = createRoot(d => {
      region(
        s.row,
        null,
        (raw: any) => {
          seen.push(raw.a.b);
        },
        1
      );
      return d;
    });
    flush();
    dispose();
    // With the deep region gone, deep writes elsewhere must not pay or
    // deliver anything (counter released; rdp refcount back to zero).
    set(d => {
      d.row.a.b = 2;
    });
    flush();
    expect(seen).toEqual([1]);
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

  it("unchanged deep values do not redeliver", () => {
    const { set, seen } = mount();
    const before = seen.length;
    set(d => {
      d.rows[0].lastSample.nbQueries = 5; // same value
    });
    flush();
    expect(seen.length).toBe(before);
  });
});
