/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Tier-1 DOM-lane bench. Diff/reconcile category — exercises `<For>`'s
// move-detection path, which the create-/replace-/update-shape benches
// in this directory do not. Two iteration shapes that hit different
// branches of `dom-expressions/reconcile.js`:
//
//   - `reverse`: every iteration reverses the list. Drives the symmetric
//     end-swap branch (`a[aStart] === b[bEnd-1] && b[bStart] === a[aEnd-1]`)
//     on every inner-loop step. This is the branch the
//     `dom-expressions` `2fe6310f` surgical fix targets; if a future
//     change reintroduces the dual-anchor pattern, this bench regresses
//     hard while `replace-full` and `update-partial` stay flat.
//   - `shuffle`: deterministic Fisher–Yates per iteration. Lands in the
//     map/LIS reorder fallback. Coverage for general permutation shapes
//     that the reverse pattern doesn't hit.
//
// Both also act as memory-leak gates: the `<For>` row owners must be
// reused, not disposed and recreated, so the owner tree must not drift
// across iterations.

import { afterAll, bench } from "vitest";
import { createRoot, createSignal, flush, For, getOwner } from "solid-js";
import { insert } from "../src/index.js";

interface Row {
  id: number;
  label: string;
}

const ROWS = 1000;

function makeRows(): Row[] {
  const rows = new Array<Row>(ROWS);
  for (let i = 0; i < ROWS; i++) rows[i] = { id: i, label: `row-${i}` };
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

function setup(name: string): Harness {
  let h!: Harness;
  const dispose = createRoot(d => {
    const root = getOwner();
    const [rows, setRows] = createSignal<Row[]>(makeRows());
    const container = document.createElement("div");
    insert(
      container,
      () => (
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

// Deterministic xorshift32 PRNG; same seed every module load keeps run-to-run
// shuffle sequences identical so bench numbers are comparable across commits.
function makeRng(seed: number) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0x7fffffff) / 0x7fffffff;
  };
}

// ---------------------------------------------------------------------------
// Reverse: drives surgical fix's symmetric end-swap branch
// ---------------------------------------------------------------------------

const reverseH = setup("reverse");
bench("reverse: 1000 rows", () => {
  const next = reverseH.current.slice().reverse();
  reverseH.current = next;
  reverseH.set(next);
  flush();
});

// ---------------------------------------------------------------------------
// Shuffle: drives map/LIS reorder fallback
// ---------------------------------------------------------------------------

const shuffleH = setup("shuffle");
const rng = makeRng(0xa5a5a5a5);
bench("shuffle: 1000 rows (Fisher-Yates)", () => {
  const next = shuffleH.current.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  shuffleH.current = next;
  shuffleH.set(next);
  flush();
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
