/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench for `spread()`'s compute half — the one-layer tracked
// copy of the source. Spread sources are nearly always proxies (`merge()` /
// `omit()` / `{...props}` in a component), so how the runtime enumerates a
// proxy IS the cost of a spread recompute. 500 elements, each iteration
// re-copying every element's source once:
//
//   merge     — `merge(static, reactive)`: the `{...props}` shape.
//   store     — the source is a store record (one `ownKeys` trap should cover
//               the key set; no descriptor trap per key).
//   plain     — a fresh plain object per update: the floor.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, createStore, flush, merge } from "solid-js";
import { spread } from "../src/index.js";

const N = 500;
const cleanups: Array<() => void> = [];
type P = Record<string, any>;
const STATIC = { id: "x", role: "row", "aria-label": "r", tabindex: "0", title: "t" };

// ── merge(static, reactive) ────────────────────────────────────────────────
const mergeSetters: Array<(p: P) => void> = [];
cleanups.push(
  createRoot(d => {
    for (let i = 0; i < N; i++) {
      const [dyn, setDyn] = createSignal<P>({ "data-a": "1", "data-b": "2", "data-c": "3" });
      mergeSetters.push(setDyn);
      const el = document.createElement("div");
      spread(el, merge(STATIC, dyn), true);
    }
    return d;
  })
);

// ── store record ───────────────────────────────────────────────────────────
const [store, setStore] = createStore<{ rows: P[] }>({
  rows: Array.from({ length: N }, () => ({
    ...STATIC,
    "data-a": "1",
    "data-b": "2",
    "data-c": "3"
  }))
});
cleanups.push(
  createRoot(d => {
    for (let i = 0; i < N; i++) {
      const el = document.createElement("div");
      spread(el, () => store.rows[i], true);
    }
    return d;
  })
);

// ── plain object per update ────────────────────────────────────────────────
const plainSetters: Array<(p: P) => void> = [];
cleanups.push(
  createRoot(d => {
    for (let i = 0; i < N; i++) {
      const [p, setP] = createSignal<P>({ ...STATIC, "data-a": "1", "data-b": "2", "data-c": "3" });
      plainSetters.push(setP);
      const el = document.createElement("div");
      spread(el, p, true);
    }
    return d;
  })
);
flush();

let tick = 0;
bench(`spread merge(static, reactive) × ${N}`, () => {
  tick++;
  const a = String(tick % 4);
  for (let i = 0; i < N; i++) mergeSetters[i]({ "data-a": a, "data-b": "2", "data-c": "3" });
  flush();
});
bench(`spread store record × ${N}`, () => {
  tick++;
  const a = String(tick % 4);
  setStore(s => {
    for (let i = 0; i < N; i++) s.rows[i]["data-a"] = a;
  });
  flush();
});
bench(`spread plain object × ${N}`, () => {
  tick++;
  const a = String(tick % 4);
  for (let i = 0; i < N; i++)
    plainSetters[i]({ ...STATIC, "data-a": a, "data-b": "2", "data-c": "3" });
  flush();
});

afterAll(() => cleanups.forEach(d => d()));
