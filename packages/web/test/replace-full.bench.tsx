/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench. Mirrors `js-framework-benchmark` `02_replace1k`.
// Mounts 1k rows once, then on every iteration replaces the full row set
// with fresh-id rows. Keyed reconcile must dispose every old row owner
// and create fresh owners. Doubles as a memory-leak gate against
// reconcile-time owner retention.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, For, getOwner } from "solid-js";
import { insert } from "../src/index.js";

interface Row {
  id: number;
  label: string;
}

const ROWS = 1000;

function makeRows(start: number): Row[] {
  const rows = new Array<Row>(ROWS);
  for (let i = 0; i < ROWS; i++) rows[i] = { id: start + i, label: `row-${start + i}` };
  return rows;
}

function ownerTotal(node: any): number {
  let count = 1;
  for (let s = node._firstChild; s; s = s._nextSibling) count += ownerTotal(s);
  return count;
}

const cleanups: Array<() => void> = [];

let rootOwner!: any;
let setRows!: (next: Row[]) => Row[];
const dispose = createRoot(d => {
  rootOwner = getOwner();
  const [rows, setR] = createSignal<Row[]>([]);
  setRows = setR;
  const container = document.createElement("div");
  insert(
    container,
    () => (
      <For each={rows()}>
        {({ id, label }) => (
          <div class={id % 10 === 0 ? "highlighted" : ""}>
            <span>{id}</span>
            <span>{label}</span>
          </div>
        )}
      </For>
    ),
    null
  );
  return d;
});
cleanups.push(dispose);

setRows(makeRows(0));
flush();
const baselineOwners = ownerTotal(rootOwner);

let seed = ROWS;
bench("replace-full: 1000 rows", () => {
  setRows(makeRows(seed));
  seed += ROWS;
  flush();
});

afterAll(() => {
  const finalOwners = ownerTotal(rootOwner);
  for (const dispose of cleanups) dispose();
  if (finalOwners - baselineOwners > 5) {
    throw new Error(
      `Owner leak detected after replace iterations: baseline=${baselineOwners}, final=${finalOwners}`
    );
  }
});
