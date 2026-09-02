import { describe, expect, it } from "vitest";
import { createRoot, createStore, flush, region } from "../../src/index.js";

/** DEEP-CHAIN regions (the emitter's `_d$` path witness): dk bumps are
 * per-record with no ancestor bubbling, so a region whose body reads
 * `raw.a.b` subscribes the witness of every intermediate record on the
 * declared chains from the compute. Resolution rides readSource — computes
 * run in the pure phase, before commitPendingNodes swaps backings, so
 * resolving through `t.v` would re-subscribe the OUTGOING children on every
 * replacement delivery (the original probe failure). */
describe("deep-chain region delivery (dbmon shape)", () => {
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
        (_t, _u, _d) => {
          const w1 = _d(_u, "lastSample");
          const w2 = _d(w1, "topFiveQueries");
          _d(w2, "0");
          _d(w2, "1");
        },
        (raw: any) => {
          seen.push(
            `${raw.lastSample.nbQueries}:${raw.lastSample.topFiveQueries[0].elapsed}:${raw.lastSample.topFiveQueries[1].elapsed}`
          );
        }
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
