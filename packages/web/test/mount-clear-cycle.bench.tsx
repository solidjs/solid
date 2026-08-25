/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench. Mounts a 1k-row `<For>` and clears it on every
// iteration. Mirrors JFB `01_run1k`/`07_create10k`/`09_clear1k_x8` in a
// single cycle. Vitest's reported mean is the *full* cycle time
// (mount + clear). Mount and clear are also timed individually via a
// `performance.now()` side channel and reported in `afterAll`, since
// vitest's `bench()` does not expose tinybench's per-iteration
// `beforeEach` hook (so we can't run a clean clear-only or mount-only
// bench in the idiomatic shape).
//
// Doubles as a memory-leak gate via `assertOwnerCount(baseline === final)`
// after all iterations. The owner leak fixed in `47c0e6fa` would have
// grown owner-tree size linearly with iteration count; this bench would
// catch a regression before the next release.

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
flush();
const baselineOwners = ownerTotal(rootOwner);

let totalMountMs = 0;
let totalClearMs = 0;
let cycles = 0;
let seed = 0;

bench("mount-clear-cycle: 1000 rows", () => {
  const t0 = performance.now();
  setRows(makeRows(seed));
  seed += ROWS;
  flush();
  const t1 = performance.now();
  setRows([]);
  flush();
  const t2 = performance.now();
  totalMountMs += t1 - t0;
  totalClearMs += t2 - t1;
  cycles++;
});

afterAll(() => {
  const finalOwners = ownerTotal(rootOwner);
  for (const dispose of cleanups) dispose();
  if (finalOwners - baselineOwners > 5) {
    throw new Error(
      `Owner leak detected after bench iterations: baseline=${baselineOwners}, final=${finalOwners}`
    );
  }
  if (cycles > 0) {
    const avgMount = totalMountMs / cycles;
    const avgClear = totalClearMs / cycles;
    // eslint-disable-next-line no-console
    console.log(
      `[mount-clear-cycle] side-channel over ${cycles} cycles — ` +
        `mount: ${avgMount.toFixed(3)}ms, clear: ${avgClear.toFixed(3)}ms, ` +
        `cycle: ${(avgMount + avgClear).toFixed(3)}ms`
    );
  }
});
