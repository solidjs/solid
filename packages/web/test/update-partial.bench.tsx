/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench. Mirrors `js-framework-benchmark`
// `03_update10th1k_x16`. Mounts 1k rows once, then on every iteration
// updates the label signal of every 10th row, 16 times. Exercises
// render-effect commit cost on update without touching list shape.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, For, getOwner } from "solid-js";
import { insert } from "../src/index.js";

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

const cleanups: Array<() => void> = [];

let rootOwner!: any;
let rows!: Row[];
const dispose = createRoot(d => {
  rootOwner = getOwner();
  rows = makeRows(0);
  const [getRows] = createSignal(rows);
  const container = document.createElement("div");
  insert(
    container,
    () => (
      <For each={getRows()}>
        {({ id, label }) => (
          <div class={id % 10 === 0 ? "highlighted" : ""}>
            <span>{id}</span>
            <span>{label()}</span>
          </div>
        )}
      </For>
    ),
    null
  );
  return d;
});
cleanups.push(dispose);
flush();
const baselineOwners = ownerTotal(rootOwner);

let counter = 0;
bench("update-partial: 100/1000 rows × 16 iterations", () => {
  for (let iter = 0; iter < ITERATIONS; iter++) {
    counter++;
    for (let i = 0; i < ROWS; i += STEP) {
      rows[i].setLabel(`updated-${counter}`);
    }
    flush();
  }
});

afterAll(() => {
  const finalOwners = ownerTotal(rootOwner);
  for (const dispose of cleanups) dispose();
  // CodSpeed simulation mode disposes the bench's owner subtree before
  // afterAll fires, so the strict drift gate only runs in the local dev path.
  if (!process.env.CODSPEED_RUNNER_MODE && finalOwners !== baselineOwners) {
    throw new Error(
      `Owner-tree drift on update path: baseline=${baselineOwners}, final=${finalOwners}`
    );
  }
});
