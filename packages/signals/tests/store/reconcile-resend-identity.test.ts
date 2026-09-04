/**
 * O7 rule test (INTERNALS-STORE-STATE.md §8) — reconcile identity fast-path
 * soundness. "Reconcile makes `next` the authoritative base": re-sending a
 * previously-ingested reference after intervening setter writes must restore
 * the incoming values — reference identity must not short-circuit the diff
 * when the store's view has diverged from that reference.
 *
 * The suites cover the same-batch case (staged override forces the slow
 * path); this pins the *flushed* case: writes committed to nodes, raw
 * untouched (2.0 never mutates sources), then the ORIGINAL object re-sent.
 * `incoming === STORE_VALUE` is true while node values have diverged — an
 * identity skip here serves stale writes instead of the authoritative next.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

describe("reconcile re-send identity (O7)", () => {
  it("re-sending the original reference after a flushed setter write restores its values", () => {
    const data = { id: 1, a: 1, b: 2 };
    const [s, setS] = createStore(data);
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.a,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    expect(seen).toEqual([1]);

    // Diverge the store's view from the ingested reference; commit it.
    setS(d => {
      d.a = 99;
    });
    flush();
    expect(s.a).toBe(99);
    expect(data.a).toBe(1); // source never mutated

    // Re-send the SAME reference: next is the authoritative base.
    setS(reconcile(data, "id"));
    flush();
    expect(s.a).toBe(1);
    expect(seen).toEqual([1, 99, 1]);
  });

  // FINDING-1 (docs/rules-mining/FINDINGS.md): failed on the legacy store —
  // applyStateFast's `next === previous` early-return skipped the diff while
  // a committed node held a diverged value. FIXED by the rewrite's ownership
  // guard (`incoming === backing && !owned(backing)`); flipped to plain `it`
  // when plain stores began serving from src/store/next (2026-08-17).
  it("re-sending the original array after a flushed row write restores row values", () => {
    const rows = [
      { id: "a", v: 1 },
      { id: "b", v: 2 }
    ];
    const [s, setS] = createStore({ rows });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.rows[0].v,
        v => {
          seen.push(v);
        }
      );
    });
    flush();

    setS(d => {
      d.rows[0].v = 50;
    });
    flush();
    expect(s.rows[0].v).toBe(50);
    expect(rows[0].v).toBe(1);

    setS(d => {
      reconcile(rows, "id")(d.rows);
    });
    flush();
    expect(s.rows[0].v).toBe(1);
    expect(seen).toEqual([1, 50, 1]);
  });

  // Control (passes on shipped): a FRESH reference carrying the original
  // values restores the setter write — shipped's per-key node writes already
  // compare against the current view. This pins the ruled contract
  // (2026-08-17: reconcile's diff baseline is the CURRENT VIEW, signal
  // parity) and shows FINDING-1 is narrowly the same-reference early-return,
  // not the diff itself.
  it("a fresh object carrying the original values also restores a flushed setter write", () => {
    const rows = [{ id: "a", v: 1 }];
    const [s, setS] = createStore({ rows });
    createRoot(() => {
      createEffect(
        () => s.rows[0].v,
        () => {}
      );
    });
    flush();

    setS(d => {
      d.rows[0].v = 50;
    });
    flush();
    expect(s.rows[0].v).toBe(50);

    setS(d => {
      reconcile([{ id: "a", v: 1 }], "id")(d.rows);
    });
    flush();
    expect(s.rows[0].v).toBe(1);
  });

  it("control: a derived store recompute re-returning the same reference reclaims a manual write", () => {
    const data = { id: 1, a: 1 };
    let setTick!: (v: number) => void;
    let s!: { id: number; a: number };
    let setS!: (fn: (d: { id: number; a: number }) => void) => void;
    createRoot(() => {
      const [tick, _setTick] = createSignal(0);
      setTick = _setTick;
      [s, setS] = createStore(
        () => {
          tick();
          return data;
        },
        { id: 0, a: 0 }
      );
      createEffect(
        () => s.a,
        () => {}
      );
    });
    flush();
    expect(s.a).toBe(1);

    setS(d => {
      d.a = 7;
    });
    flush();
    expect(s.a).toBe(7);

    // Recompute returns the identical reference; it is the authoritative
    // output of the derive — the manual write must not survive it (core R31:
    // "the next source change reclaims the slot").
    setTick(1);
    flush();
    expect(s.a).toBe(1);
  });
});
