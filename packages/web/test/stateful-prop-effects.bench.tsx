/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench: the cost of giving stateful DOM properties
// (`value`, `checked`) their own effect (#4186). Each row renders a text
// input and a checkbox whose stateful property sits between other dynamic
// attributes, so the compiler splits the row's bindings around it in source
// order instead of folding all of them into one grouped effect:
//
//   <input class={cls} value={v} min={min} />
//   <input type="checkbox" class={cls} checked={done} />
//
// Three shapes over 1k rows: mount+clear, an update of an unrelated attribute
// (`class`) on every row, and an update of `value` on every row. The owner
// count per row is logged once so the effect-node delta is visible.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, For, getOwner } from "solid-js";
import { insert } from "../src/index.js";

interface Row {
  id: number;
  cls: () => string;
  setCls: (next: string) => string;
  v: () => string;
  setV: (next: string) => string;
  min: () => number;
  done: () => boolean;
}

const ROWS = 1000;

function makeRows(start: number): Row[] {
  const rows = new Array<Row>(ROWS);
  for (let i = 0; i < ROWS; i++) {
    const [cls, setCls] = createSignal(`row-${start + i}`);
    const [v, setV] = createSignal(`${start + i}`);
    const [min] = createSignal(0);
    const [done] = createSignal((start + i) % 2 === 0);
    rows[i] = { id: start + i, cls, setCls, v, setV, min, done };
  }
  return rows;
}

function ownerTotal(node: any): number {
  let count = 1;
  for (let s = node._firstChild; s; s = s._nextSibling) count += ownerTotal(s);
  return count;
}

const renderRow = (row: Row) => (
  <div>
    <input class={row.cls()} value={row.v()} min={row.min()} />
    <input type="checkbox" class={row.cls()} checked={row.done()} />
  </div>
);

const cleanups: Array<() => void> = [];
const drifts: Array<() => void> = [];

function mountRows(rows: Row[]) {
  let rootOwner!: any;
  const dispose = createRoot(d => {
    rootOwner = getOwner();
    const [getRows] = createSignal(rows);
    const container = document.createElement("div");
    insert(container, () => <For each={getRows()}>{renderRow}</For>, null);
    return d;
  });
  cleanups.push(dispose);
  flush();
  return rootOwner;
}

// --- owner count ------------------------------------------------------

{
  const empty = mountRows([]);
  const full = mountRows(makeRows(0));
  console.log(
    `[stateful-prop-effects] owners per row: ${(ownerTotal(full) - ownerTotal(empty)) / ROWS}`
  );
}

// --- mount + clear ----------------------------------------------------

{
  let rootOwner!: any;
  let setRows!: (next: Row[]) => Row[];
  const dispose = createRoot(d => {
    rootOwner = getOwner();
    const [rows, setR] = createSignal<Row[]>([]);
    setRows = setR;
    const container = document.createElement("div");
    insert(container, () => <For each={rows()}>{renderRow}</For>, null);
    return d;
  });
  cleanups.push(dispose);
  flush();
  const baseline = ownerTotal(rootOwner);
  let seed = 0;

  bench("stateful-prop mount+clear 1000 rows", () => {
    setRows(makeRows(seed));
    seed += ROWS;
    flush();
    setRows([]);
    flush();
  });

  drifts.push(() => {
    const final = ownerTotal(rootOwner);
    if (final - baseline > 5)
      throw new Error(`owner leak on mount+clear: baseline=${baseline}, final=${final}`);
  });
}

// --- update class on every row ----------------------------------------

{
  const rows = makeRows(0);
  mountRows(rows);
  let counter = 0;
  bench("stateful-prop update class 1000/1000 rows", () => {
    counter++;
    for (let i = 0; i < ROWS; i++) rows[i].setCls(`cls-${counter}`);
    flush();
  });
}

// --- update value on every row ----------------------------------------

{
  const rows = makeRows(0);
  mountRows(rows);
  let counter = 0;
  bench("stateful-prop update value 1000/1000 rows", () => {
    counter++;
    for (let i = 0; i < ROWS; i++) rows[i].setV(`v-${counter}`);
    flush();
  });
}

afterAll(() => {
  const errors: string[] = [];
  for (const check of drifts) {
    try {
      check();
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const dispose of cleanups) dispose();
  if (errors.length) throw new Error(errors.join("\n"));
});
