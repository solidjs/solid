import { afterEach, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending
} from "../../src/index.js";

// #3038: a store computed's `_child` chain carried one firewall child per
// materialized leaf, and the post-recompute companion walk visited ALL of
// them on every update — O(total leaves ever read) per flush even in apps
// that never call isPending()/latest(). The walk had to be gated on a
// companion actually existing below the firewall.
//
// Re-pinned 2026-10-03 (carve, L2): there is no `_child` chain and no
// companion walk — a leaf is a plain node of its family, a verdict window
// reads it (and pulls the derive) directly, and nothing is visited per
// update beyond the leaves a pass reads. What this file pins is the
// behaviour the gate protected: a store update costs O(written) with or
// without a verdict reader below the derive, and the verdict still answers.

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

function setup() {
  const [source, setSource] = createSignal(0);
  let state!: { rows: { id: number; label: string; count: number }[] };
  let derives = 0;
  createRoot(d => {
    dispose = d;
    [state] = createStore(
      () => {
        derives++;
        return {
          rows: Array.from({ length: 50 }, (_, i) => ({
            id: i,
            label: `row ${i} v${source()}`,
            count: source()
          }))
        };
      },
      { rows: [] }
    );
    // Materialize many leaves: tracked reads of each row.
    createEffect(
      () => state.rows.map(r => r.label + r.count).join(","),
      () => {}
    );
  });
  flush();
  return { state, setSource, derives: () => derives };
}

it("sync-only apps: one derive per update, nothing walked (#3038)", () => {
  const { setSource, derives } = setup();
  const before = derives();
  for (let i = 1; i <= 5; i++) {
    setSource(i);
    flush();
  }
  expect(derives()).toBe(before + 5);
});

it("a verdict reader below the derive costs nothing extra, and verdicts still snap", () => {
  const { state, setSource, derives } = setup();
  let pending: boolean | undefined;
  let probes = 0;
  createRoot(() => {
    createEffect(
      () => {
        probes++;
        return (pending = isPending(() => state.rows[0].count));
      },
      () => {}
    );
  });
  flush();
  expect(pending).toBe(false);
  const before = derives();
  const probesBefore = probes;
  setSource(10);
  flush();
  // One derive; the probe re-runs once for the leaf it reads.
  expect(derives()).toBe(before + 1);
  expect(probes).toBe(probesBefore + 1);
  // The verdict machinery still answers: a sync derive is final.
  expect(pending).toBe(false);
  expect(state.rows[0].count).toBe(10);
});
