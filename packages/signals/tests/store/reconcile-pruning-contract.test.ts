/**
 * THE PRUNING CONTRACT (R18 + the O7 under-witness amendment).
 *
 * The React-like property this store lives on: KEYED reconcile diffs only
 * what is listened to. Two pruning layers, both pinned here:
 *   1. Never-wrapped records (no target exists) are skipped ALWAYS — even
 *      under a witness ("nothing proxied below").
 *   2. Wrapped-but-unsubscribed records are pruned by R18 (`!ct.d` detach:
 *      captured proxies deliberately go stale) — UNLESS beneath a live deep
 *      witness (the O7 amendment: a witness IS the subscription for its
 *      subtree). Cost under a witness is O(wrapped), never O(store).
 *
 * Probe: __adoptVisits counts records the adoption walk enters.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  untrack
} from "../../src/index.js";
import { __adoptVisits, __resetAdoptVisits } from "../../src/store/next/reconcile.js";
// Internal machinery — deliberately NOT a public export (the compiler-emitted
// coarse-row track is its consumer; user code never calls it directly).
import { witnessNext as witness } from "../../src/store/next/store.js";

const ROWS = 1000;

function makeRows(rev: number) {
  const rows = new Array(ROWS);
  for (let i = 0; i < ROWS; i++) rows[i] = { id: i, label: `row ${i} rev ${rev}` };
  return rows;
}

function apply(setState: any, rev: number) {
  __resetAdoptVisits();
  setState((s: any) => {
    reconcile({ rows: makeRows(rev) }, "id")(s);
  });
  flush();
  return __adoptVisits;
}

describe("keyed reconcile pruning contract (R18 + O7)", () => {
  it("never-wrapped rows are skipped even under a witness (O(wrapped), not O(store))", () => {
    createRoot(() => {
      const [state, setState] = createStore({ rows: makeRows(0) });
      createEffect(
        () => witness(state.rows),
        () => {}
      );
      flush();
      // No row was ever wrapped — the whole 1000-row store diffs in O(1).
      const visits = apply(setState, 1);
      expect(visits).toBeLessThan(10);
    });
  });

  it("unwitnessed: wrapped-but-unsubscribed rows prune (R18) and captures stay stale", () => {
    createRoot(() => {
      const [state, setState] = createStore({ rows: makeRows(0) });
      // Wrap EVERY row (render-like), subscribe only one.
      untrack(() => {
        for (let i = 0; i < ROWS; i++) void state.rows[i].label;
      });
      let seen = "";
      createEffect(
        () => state.rows[3].label,
        (v: string) => {
          seen = v;
        }
      );
      flush();
      const stray = state.rows[700];

      const visits = apply(setState, 1);
      // All 1000 wrapped, ONE subscribed: the diff stays O(subscribed).
      expect(visits).toBeLessThan(20);
      expect(seen).toBe("row 3 rev 1");
      // R18 unchanged without a witness: the unobserved capture detached.
      expect(stray.label).toBe("row 700 rev 0");
    });
  });

  it("witnessed: wrapped rows under the witness stay live + identity-stable (the O7 amendment)", () => {
    createRoot(() => {
      const [state, setState] = createStore({ rows: makeRows(0) });
      untrack(() => {
        for (let i = 0; i < ROWS; i++) void state.rows[i].label;
      });
      createEffect(
        () => witness(state.rows),
        () => {}
      );
      flush();
      const captured = state.rows[700];

      const visits = apply(setState, 1);
      // The witness observes its subtree: all wrapped rows adopt…
      expect(visits).toBeGreaterThan(ROWS);
      // …and identity + freshness hold with zero per-row subscriptions.
      expect(captured.label).toBe("row 700 rev 1");
      expect(state.rows[700]).toBe(captured);
    });
  });

  it("witness released: R18 pruning restored", () => {
    createRoot(dispose => {
      const [state, setState] = createStore({ rows: makeRows(0) });
      untrack(() => {
        for (let i = 0; i < ROWS; i++) void state.rows[i].label;
      });
      let stop!: () => void;
      createRoot(d => {
        stop = d;
        createEffect(
          () => witness(state.rows),
          () => {}
        );
      });
      flush();
      const visitsWitnessed = apply(setState, 1);
      expect(visitsWitnessed).toBeGreaterThan(ROWS);

      stop(); // dispose the witness → dk unobserved → sweep releases
      flush();
      const visitsAfter = apply(setState, 2);
      expect(visitsAfter).toBeLessThan(20);
      dispose();
    });
  });
});
