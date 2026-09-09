/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench for OBJECT-VALUED `style` / `class` bindings — the
// non-inline case (`style={obj}`, `class={obj}`), where the compiler cannot
// split per property and the runtime enumerates the object. Six rows over 500
// elements, each iteration re-applying every element once:
//
//   plain     — a fresh plain object per update (a signal of objects): the
//               common case; must stay allocation-free through snapshot().
//   store     — the binding's value is a STORE sub-object, replaced per update
//               (identity change): pays snapshot's proxy copy + per-key tracking.
//   in-place  — the store sub-object is mutated per update: only reactive
//               through the tracked snapshot (identity-only tracking never
//               re-applied these).

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, createStore, flush } from "solid-js";
import { insert } from "../src/index.js";

const N = 500;
const cleanups: Array<() => void> = [];
type Style = Record<string, string>;
type Classes = Record<string, boolean>;

// ── plain objects via signals ──────────────────────────────────────────────
const styleSetters: Array<(s: Style) => void> = [];
const classSetters: Array<(c: Classes) => void> = [];
cleanups.push(
  createRoot(d => {
    const container = document.createElement("div");
    for (let i = 0; i < N; i++) {
      const [style, setStyle] = createSignal<Style>({
        "stroke-width": "1",
        "stroke-opacity": "0.5"
      });
      const [cls, setCls] = createSignal<Classes>({ base: true, on: false });
      styleSetters.push(setStyle);
      classSetters.push(setCls);
      insert(container, () => <div style={style()} class={cls()} />, null);
    }
    return d;
  })
);

// ── store sub-objects ──────────────────────────────────────────────────────
const [store, setStore] = createStore<{ rows: { style: Style; cls: Classes }[] }>({
  rows: Array.from({ length: N }, () => ({
    style: { "stroke-width": "1", "stroke-opacity": "0.5" },
    cls: { base: true, on: false }
  }))
});
cleanups.push(
  createRoot(d => {
    const container = document.createElement("div");
    for (let i = 0; i < N; i++)
      insert(container, () => <div style={store.rows[i].style} class={store.rows[i].cls} />, null);
    return d;
  })
);
flush();

let tick = 0;
bench(`style plain object × ${N}`, () => {
  tick++;
  const w = String(1 + (tick % 4));
  for (let i = 0; i < N; i++) styleSetters[i]({ "stroke-width": w, "stroke-opacity": "0.5" });
  flush();
});
bench(`class plain object × ${N}`, () => {
  tick++;
  const on = (tick & 1) === 1;
  for (let i = 0; i < N; i++) classSetters[i]({ base: true, on });
  flush();
});
bench(`style store object, replaced × ${N}`, () => {
  tick++;
  const w = String(1 + (tick % 4));
  setStore(s => {
    for (let i = 0; i < N; i++) s.rows[i].style = { "stroke-width": w, "stroke-opacity": "0.5" };
  });
  flush();
});
bench(`class store object, replaced × ${N}`, () => {
  tick++;
  const on = (tick & 1) === 1;
  setStore(s => {
    for (let i = 0; i < N; i++) s.rows[i].cls = { base: true, on };
  });
  flush();
});
bench(`style store object, mutated in place × ${N}`, () => {
  tick++;
  const w = String(1 + (tick % 4));
  setStore(s => {
    for (let i = 0; i < N; i++) s.rows[i].style["stroke-width"] = w;
  });
  flush();
});
bench(`class store object, toggled in place × ${N}`, () => {
  tick++;
  const on = (tick & 1) === 1;
  setStore(s => {
    for (let i = 0; i < N; i++) s.rows[i].cls.on = on;
  });
  flush();
});

afterAll(() => {
  for (const d of cleanups) d();
});
