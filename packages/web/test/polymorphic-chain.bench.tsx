/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench: the props plumbing of a headless-UI component
// chain. Two forms render the SAME `<a>` (see test/harness/polymorphic.tsx):
//
//   compiled — the element written directly. Floor.
//   chain    — `<DialogTrigger as="a" …>` → `ButtonRoot` → `Polymorphic` →
//              `dynamic(() => props.as)`: four `merge`s (two of them the
//              compiler's call-site `mergeProps`), three `omit`s, and one
//              spread reading through all of them. This is the Kobalte shape
//              for every element it renders.
//
// Two workloads, mirroring JFB `01_run1k`/`09_clear1k` and `03_update10th1k`:
// mount+clear 1k rows, and update every 10th row's label (which flows through
// the chain into aria-label, title, and text) 16 times. Owner-tree drift is
// gated in afterAll.
//
// The delta between the two forms is the number that matters: it is the
// per-element cost of composing our props primitives, and the thing this
// bench exists to drive down.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, getOwner } from "solid-js";
import { insert } from "../src/index.js";
import { forms, makeRows, TriggerList, type Row } from "./harness/polymorphic.jsx";

const ROWS = 1000;
const STEP = 10;
const ITERATIONS = 16;

function ownerTotal(node: any): number {
  let count = 1;
  for (let s = node._firstChild; s; s = s._nextSibling) count += ownerTotal(s);
  return count;
}

const cleanups: Array<() => void> = [];
const drifts: Array<() => void> = [];

// --- mount + clear -----------------------------------------------------

for (const name of Object.keys(forms) as Array<keyof typeof forms>) {
  const render = forms[name];
  let rootOwner!: any;
  let setRows!: (next: Row[]) => Row[];
  const dispose = createRoot(d => {
    rootOwner = getOwner();
    const [rows, setR] = createSignal<Row[]>([]);
    setRows = setR;
    const container = document.createElement("div");
    insert(container, () => <TriggerList rows={rows} render={render} />, null);
    return d;
  });
  cleanups.push(dispose);
  flush();
  const baseline = ownerTotal(rootOwner);
  let seed = 0;

  bench(`polymorphic-chain mount+clear ${ROWS} rows: ${name}`, () => {
    setRows(makeRows(seed, ROWS));
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
  const render = forms[name];
  let rootOwner!: any;
  let rows!: Row[];
  const dispose = createRoot(d => {
    rootOwner = getOwner();
    rows = makeRows(0, ROWS);
    const [getRows] = createSignal(rows);
    const container = document.createElement("div");
    insert(container, () => <TriggerList rows={getRows} render={render} />, null);
    return d;
  });
  cleanups.push(dispose);
  flush();
  const baseline = ownerTotal(rootOwner);
  let counter = 0;

  bench(`polymorphic-chain update ${ROWS / STEP}/${ROWS} rows × ${ITERATIONS}: ${name}`, () => {
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
