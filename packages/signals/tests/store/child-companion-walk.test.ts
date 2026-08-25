import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending
} from "../../src/index.js";
import { GlobalQueue } from "../../src/core/scheduler.js";

// #3038: a store computed's `_child` chain carries one firewall child per
// materialized leaf, and the post-recompute companion walk visited ALL of
// them on every update — O(total leaves ever read) per flush even in apps
// that never call isPending()/latest(). The walk must be gated on a
// companion actually existing below the firewall (CONFIG_CHILD_COMPANIONS).

let dispose: (() => void) | undefined;
const origWalk = GlobalQueue._updateChildCompanions;
let walkCalls = 0;

beforeEach(() => {
  walkCalls = 0;
  GlobalQueue._updateChildCompanions = el => {
    walkCalls++;
    origWalk!(el);
  };
});

afterEach(() => {
  GlobalQueue._updateChildCompanions = origWalk;
  dispose?.();
  dispose = undefined;
});

function setup() {
  const [source, setSource] = createSignal(0);
  let state!: { rows: { id: number; label: string; count: number }[] };
  createRoot(d => {
    dispose = d;
    [state] = createStore(
      () => ({
        rows: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          label: `row ${i} v${source()}`,
          count: source()
        }))
      }),
      { rows: [] }
    );
    // Materialize firewall-child nodes: tracked reads of many leaves.
    createEffect(
      () => state.rows.map(r => r.label + r.count).join(","),
      () => {}
    );
  });
  flush();
  return { state, setSource };
}

it("sync-only apps never pay the child-companion walk (#3038)", () => {
  const { setSource } = setup();
  walkCalls = 0;
  for (let i = 1; i <= 5; i++) {
    setSource(i);
    flush();
  }
  expect(walkCalls).toBe(0);
});

it("a companion below the firewall arms the walk, and verdicts still snap", () => {
  const { state, setSource } = setup();
  // Creating an isPending companion on ONE leaf arms the store computed.
  let pending: boolean | undefined;
  createRoot(() => {
    createEffect(
      () => (pending = isPending(() => state.rows[0].count)),
      () => {}
    );
  });
  flush();
  expect(pending).toBe(false);
  walkCalls = 0;
  setSource(10);
  flush();
  expect(walkCalls).toBeGreaterThan(0);
  // The verdict machinery still answers through the gated walk.
  expect(pending).toBe(false);
  expect(state.rows[0].count).toBe(10);
});
