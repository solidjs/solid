/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench. Single-item and sparse structural edits on a keyed
// 1k-row `<For>` — the shape the Octane board's uibench one-item tree ops
// (4–6× Octane on 2026-10-15), js-framework-reorder `removefirst` (2.5×) and
// the table filters measure, and the one neither `reconcile-permute` (moves)
// nor `replace-full` / `mount-clear-cycle` (bulk) covers. Each iteration pairs
// a removal with the insertion that undoes it so the list stays 1000 rows and
// both directions are timed; the number to watch is µs per pair.
//
// Profiled 2026-10-15 (uibench `tree/[500]/[removeLast(1)]`, CDP): the edit
// itself is a few hundred nanoseconds; the cost was four newLen-sized staged
// arrays plus a Map in `updateKeyedMap`'s general path, then normalize's
// flattened copy and the reconcile prefix scan. `mapArray`'s subsequence fast
// paths remove the first part; this bench is the regression gate for it and
// the measuring stick for the rest.
//
// Also a memory-leak gate: survivors must keep their row owners, so the owner
// tree must not drift across iterations.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, For, getOwner } from "solid-js";
import { insert } from "../src/index.js";

interface Row {
  id: number;
  label: string;
}

const ROWS = 1000;

function makeRows(from = 0): Row[] {
  const rows = new Array<Row>(ROWS);
  for (let i = 0; i < ROWS; i++) rows[i] = { id: from + i, label: `row-${from + i}` };
  return rows;
}

function ownerTotal(node: any): number {
  let count = 1;
  for (let s = node._firstChild; s; s = s._nextSibling) count += ownerTotal(s);
  return count;
}

interface Harness {
  current: Row[];
  set: (next: Row[]) => Row[];
  root: any;
  baselineOwners: number;
}

const cleanups: Array<() => void> = [];
const harnesses: Array<{ name: string; harness: Harness }> = [];

function setup(name: string, keyed?: (row: Row) => number): Harness {
  let h!: Harness;
  const dispose = createRoot(d => {
    const root = getOwner();
    const [rows, setRows] = createSignal<Row[]>(makeRows());
    const container = document.createElement("div");
    insert(
      container,
      () =>
        keyed ? (
          <For each={rows()} keyed={keyed}>
            {row => (
              <div>
                <span>{row().id}</span>
                <span>{row().label}</span>
              </div>
            )}
          </For>
        ) : (
          <For each={rows()}>
            {({ id, label }) => (
              <div>
                <span>{id}</span>
                <span>{label}</span>
              </div>
            )}
          </For>
        ),
      null
    );
    h = { current: rows(), set: setRows, root, baselineOwners: 0 };
    return d;
  });
  cleanups.push(dispose);
  flush();
  h.baselineOwners = ownerTotal(h.root);
  harnesses.push({ name, harness: h });
  return h;
}

function commit(h: Harness, next: Row[]) {
  h.current = next;
  h.set(next);
  flush();
}

// ---------------------------------------------------------------------------
// Tail: remove last, insert last (uibench removeLast(1) / insertLast(1))
// ---------------------------------------------------------------------------

const tailH = setup("tail");
bench("tail: remove last + insert last (1000 rows)", () => {
  const removed = tailH.current[ROWS - 1]!;
  commit(tailH, tailH.current.slice(0, -1));
  commit(tailH, [...tailH.current, removed]);
});

// ---------------------------------------------------------------------------
// Head: remove first, insert first (jfb-reorder removefirst, uibench *First(1))
// ---------------------------------------------------------------------------

const headH = setup("head");
bench("head: remove first + insert first (1000 rows)", () => {
  const removed = headH.current[0]!;
  commit(headH, headH.current.slice(1));
  commit(headH, [removed, ...headH.current]);
});

// ---------------------------------------------------------------------------
// Middle: remove at 500, insert back at 500
// ---------------------------------------------------------------------------

const midH = setup("middle");
bench("middle: remove at 500 + insert at 500 (1000 rows)", () => {
  const cur = midH.current;
  const removed = cur[500]!;
  commit(midH, [...cur.slice(0, 500), ...cur.slice(501)]);
  const c2 = midH.current;
  commit(midH, [...c2.slice(0, 500), removed, ...c2.slice(500)]);
});

// ---------------------------------------------------------------------------
// Scattered: remove every 10th row (100), insert them back (uibench filter,
// effectful-list remove_100_scattered, jfb-reorder removeevery10)
// ---------------------------------------------------------------------------

const scatterH = setup("scattered");
bench("scattered: remove every 10th + insert back (1000 rows)", () => {
  const cur = scatterH.current;
  commit(
    scatterH,
    cur.filter((_, i) => i % 10 !== 9)
  );
  const c2 = scatterH.current;
  const back = new Array<Row>(ROWS);
  for (let i = 0, j = 0; i < ROWS; i++) back[i] = i % 10 === 9 ? cur[i]! : c2[j++]!;
  commit(scatterH, back);
});

// ---------------------------------------------------------------------------
// Key-function mode: row signals + index signals on the same tail edit
// ---------------------------------------------------------------------------

const keyedTailH = setup("tail keyed-fn", row => row.id);
bench("tail, keyed by fn: remove last + insert last (1000 rows)", () => {
  const removed = keyedTailH.current[ROWS - 1]!;
  commit(keyedTailH, keyedTailH.current.slice(0, -1));
  commit(keyedTailH, [...keyedTailH.current, removed]);
});

afterAll(() => {
  for (const { name, harness } of harnesses) {
    const final = ownerTotal(harness.root);
    if (final - harness.baselineOwners > 5) {
      throw new Error(
        `Owner leak in ${name} bench: baseline=${harness.baselineOwners}, final=${final}`
      );
    }
  }
  for (const dispose of cleanups) dispose();
});
