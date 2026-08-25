// Tier-1 store-lane bench. Diff/reconcile category — the UIBench lane.
//
// UIBench drives Solid entirely through `store` + `reconcile()`: every frame
// the harness hands the framework a fresh *immutable* state tree, and Solid
// reconciles it into a `createStore` so fine-grained updates fall out of the
// diff. The rendered `<For>` components just read the already-reconciled
// store. So UIBench's hot path for Solid is `store/reconcile.ts` — the keyed
// array reorder (map/LIS), node reuse, and `applyState` value walk — NOT
// `mapArray`/`dom-expressions` (that is the JFB/DOM lane, covered by
// `packages/web/test/reconcile-permute.bench.tsx`).
//
// This bench mirrors UIBench's `tree` scenario: a nested tree of keyed
// `{ id, children }` nodes reconciled per iteration. Each frame produces a
// new immutable tree that preserves ids but reorders children, so
// `reconcile` takes the move-detection path recursively at every level
// rather than replacing nodes. A recursive tracking effect subscribes to
// every node id and children index (what a recursive `<For>` would do), so
// the reorder actually reuses nodes and re-runs consumers.
//
//   - `reverse`: reverse every children array at every level. Leading/
//     trailing scans fail immediately -> full map/LIS reorder fallback at
//     each node. Hottest signal for the keyed-reorder path.
//   - `shuffle`: deterministic Fisher-Yates per children array. General
//     permutation coverage for the same fallback.
import { afterAll, bench } from "vitest";
import { createEffect, createRoot, createStore, flush, reconcile } from "../../src/index.js";

interface TreeNode {
  id: number;
  children: TreeNode[];
}

// root + 10 + 100 + 1000 = 1111 nodes, matching UIBench-tree magnitude.
const FANOUT = 10;
const DEPTH = 3;

// Fixed-id template built once; ids are stable so per-frame permutations are
// detected as moves (not replacements) by `reconcile(v, "id")`.
let nextId = 0;
function buildTemplate(depth: number): TreeNode {
  const id = nextId++;
  const children: TreeNode[] = [];
  if (depth < DEPTH) for (let i = 0; i < FANOUT; i++) children.push(buildTemplate(depth + 1));
  return { id, children };
}
const TEMPLATE = buildTemplate(0);

function cloneTree(node: TreeNode): TreeNode {
  return { id: node.id, children: node.children.map(cloneTree) };
}

function reversedClone(node: TreeNode): TreeNode {
  const children = node.children.map(reversedClone);
  children.reverse();
  return { id: node.id, children };
}

// Deterministic xorshift32 so shuffle sequences are identical across commits.
function makeRng(seed: number) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0x7fffffff) / 0x7fffffff;
  };
}

function shuffledClone(node: TreeNode, rng: () => number): TreeNode {
  const children = node.children.map(c => shuffledClone(c, rng));
  for (let i = children.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = children[i]!;
    children[i] = children[j]!;
    children[j] = tmp;
  }
  return { id: node.id, children };
}

// Recursive read mirrors a recursive `<For>`: subscribes to each node id and
// each children index so reconcile's reorder reuses nodes and notifies.
function track(node: TreeNode) {
  void node.id;
  const kids = node.children;
  for (let i = 0, len = kids.length; i < len; i++) track(kids[i]!);
}

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const dispose of cleanups) dispose();
});

function setup() {
  let set!: (v: TreeNode) => void;
  const dispose = createRoot(d => {
    const [state, setState] = createStore<TreeNode>(cloneTree(TEMPLATE));
    set = v => setState(reconcile(v, "id"));
    createEffect(
      () => track(state),
      () => {}
    );
    return d;
  });
  cleanups.push(dispose);
  flush();
  return set;
}

// ---------------------------------------------------------------------------
// Reverse: full recursive reversal every frame.
// ---------------------------------------------------------------------------
const reverseSet = setup();
let reverseCur = cloneTree(TEMPLATE);
bench("store reconcile tree reverse: 1111 keyed nodes", () => {
  const next = reversedClone(reverseCur);
  reverseCur = next;
  reverseSet(next);
  flush();
});

// ---------------------------------------------------------------------------
// Shuffle: deterministic Fisher-Yates per children array every frame.
// ---------------------------------------------------------------------------
const shuffleSet = setup();
let shuffleCur = cloneTree(TEMPLATE);
const rng = makeRng(0xa5a5a5a5);
bench("store reconcile tree shuffle: 1111 keyed nodes", () => {
  const next = shuffledClone(shuffleCur, rng);
  shuffleCur = next;
  shuffleSet(next);
  flush();
});
