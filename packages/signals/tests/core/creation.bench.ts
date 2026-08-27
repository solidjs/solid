// Creation-cost tier-1 benches (stage-3 regression fence).
//
// Stage 3's wins were CREATION-shaped: literal diets, one fixed-order
// hidden-class chain per node kind, the `_x` cold-field split, pre-shaped
// store targets. A single added field or an eagerly-allocated extension
// regresses them, and the existing benches only cover signal/memo creation
// (reactivity.bench.ts) — effects, owners, store wrapping, and disposal had
// no fence. These benches make such changes visible to CodSpeed as
// allocation/store instructions on every PR.
import { bench } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

const COUNT = 10_000;
const ROWS = 1_000;
const filter = new RegExp(process.env.FILTER || ".+");

function runBench(name: string, fn: () => void) {
  if (filter.test(name)) bench(name, fn);
}

// Effect + owner-slot creation and first run (the `_x` split surface: a
// per-effect extension allocation lands squarely here).
runBench("createEffects:create1to1", () => {
  const setters = new Array<(v: number) => number>(COUNT);
  createRoot(dispose => {
    for (let i = 0; i < COUNT; i++) {
      const [source, setSource] = createSignal(i);
      setters[i] = setSource;
      createEffect(
        () => source(),
        () => {}
      );
    }
    flush();
    dispose();
  });
});

// Owner scopes alone (root literal + owner chain wiring).
runBench("createOwners", () => {
  const disposers = new Array<() => void>(COUNT);
  for (let i = 0; i < COUNT; i++) {
    disposers[i] = createRoot(dispose => dispose);
  }
  for (let i = 0; i < COUNT; i++) disposers[i]();
});

// Store target creation: wrap a fresh deep store and touch every record so
// each allocates its target + proxy (TargetShape's fixed field order and
// the array/dictionary-mode cliff both land here).
runBench("storeWrap:deep 1k records", () => {
  const rows = new Array(ROWS);
  for (let i = 0; i < ROWS; i++) rows[i] = { id: i, label: "row " + i, count: 0 };
  const [state] = createStore({ rows });
  let touched = 0;
  for (let i = 0; i < ROWS; i++) if (state.rows[i].id === i) touched++;
  if (touched !== ROWS) throw new Error("wrap miss");
});

// Shallow store wrap: slots served verbatim — only the container wraps.
runBench("storeWrap:shallow 1k records", () => {
  const rows = new Array(ROWS);
  for (let i = 0; i < ROWS; i++) rows[i] = { id: i, label: "row " + i, count: 0 };
  const [state] = createStore(rows, { shallow: true });
  let touched = 0;
  for (let i = 0; i < ROWS; i++) if (state[i].id === i) touched++;
  if (touched !== ROWS) throw new Error("wrap miss");
});

// Creation + teardown of an owned graph (disposeChildren/unlinkSubs walk —
// stage-1/3 touched disposal; a per-node teardown regression shows here).
runBench("createDispose:memoTree", () => {
  const [s, set] = createSignal(0);
  createRoot(dispose => {
    for (let i = 0; i < COUNT; i++) {
      const m = createMemo(() => s() + i);
      m();
    }
    dispose();
  });
  set(v => v + 1);
  flush();
});
