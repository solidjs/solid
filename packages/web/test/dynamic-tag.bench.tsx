/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench: the cost of an element whose tag is only known at
// runtime. Three forms render the SAME row — a `<div>` with one static
// attribute, one reactive attribute, and reactive text — so the deltas are
// attributable to the form alone:
//
//   compiled  — `<div class=… title={…}>{…}</div>`: the compiler knows the
//               tag, so each binding is its own effect on a direct DOM op.
//   dynamic   — `const Div = dynamic(() => "div")` used as a component: the
//               preferred form. Props arrive as a plain getter object and
//               ride ONE spread (three effects + runtime attribute dispatch
//               in assign()), because nothing about the tag is compiled.
//   Dynamic   — `<Dynamic component="div" …>`: the wrapper form. Same as
//               above plus an `omit()` proxy in front of the spread.
//
// Two shapes per form, mirroring JFB `01_run1k`/`09_clear1k` and
// `03_update10th1k_x16`: mount+clear 1k rows, and update every 10th row's
// reactive attribute + text 16 times. Owner-tree drift is gated in
// afterAll (the update trees are long-lived; the mount trees must return
// to baseline on clear).
//
// Measurement only — this bench exists to keep the "dynamic components are
// slow" claim honest with numbers before anything is optimized.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, For, getOwner, type JSX } from "solid-js";
import { dynamic, Dynamic, insert } from "../src/index.js";

interface Row {
  id: number;
  label: () => string;
  setLabel: (next: string) => string;
}

const ROWS = 1000;
const STEP = 10;
const ITERATIONS = 16;

function makeRows(start: number): Row[] {
  const rows = new Array<Row>(ROWS);
  for (let i = 0; i < ROWS; i++) {
    const [label, setLabel] = createSignal(`row-${start + i}`);
    rows[i] = { id: start + i, label, setLabel };
  }
  return rows;
}

function ownerTotal(node: any): number {
  let count = 1;
  for (let s = node._firstChild; s; s = s._nextSibling) count += ownerTotal(s);
  return count;
}

const Div = dynamic(() => "div");

type RowRenderer = (row: Row) => JSX.Element;

const forms: Record<"compiled" | "dynamic" | "Dynamic", RowRenderer> = {
  compiled: ({ label }) => (
    <div class="row" title={label()}>
      {label()}
    </div>
  ),
  dynamic: ({ label }) => (
    <Div class="row" title={label()}>
      {label()}
    </Div>
  ),
  Dynamic: ({ label }) => (
    <Dynamic component="div" class="row" title={label()}>
      {label()}
    </Dynamic>
  )
};

const cleanups: Array<() => void> = [];
const drifts: Array<() => void> = [];

// --- mount + clear -----------------------------------------------------

for (const name of Object.keys(forms) as Array<keyof typeof forms>) {
  const renderRow = forms[name];
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

  bench(`dynamic-tag mount+clear 1000 rows: ${name}`, () => {
    setRows(makeRows(seed));
    seed += ROWS;
    flush();
    setRows([]);
    flush();
  });

  drifts.push(() => {
    const final = ownerTotal(rootOwner);
    if (final - baseline > 5)
      throw new Error(`[${name}] owner leak on mount+clear: baseline=${baseline}, final=${final}`);
  });
}

// --- update 10th ------------------------------------------------------

for (const name of Object.keys(forms) as Array<keyof typeof forms>) {
  const renderRow = forms[name];
  let rootOwner!: any;
  let rows!: Row[];
  const dispose = createRoot(d => {
    rootOwner = getOwner();
    rows = makeRows(0);
    const [getRows] = createSignal(rows);
    const container = document.createElement("div");
    insert(container, () => <For each={getRows()}>{renderRow}</For>, null);
    return d;
  });
  cleanups.push(dispose);
  flush();
  const baseline = ownerTotal(rootOwner);
  let counter = 0;

  bench(`dynamic-tag update 100/1000 rows × 16: ${name}`, () => {
    for (let iter = 0; iter < ITERATIONS; iter++) {
      counter++;
      for (let i = 0; i < ROWS; i += STEP) rows[i].setLabel(`updated-${counter}`);
      flush();
    }
  });

  drifts.push(() => {
    const final = ownerTotal(rootOwner);
    // CodSpeed simulation mode disposes bench owner subtrees before afterAll
    // fires, so the strict drift gate only runs in the local dev path.
    if (!process.env.CODSPEED_RUNNER_MODE && final !== baseline)
      throw new Error(`[${name}] owner drift on update: baseline=${baseline}, final=${final}`);
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
