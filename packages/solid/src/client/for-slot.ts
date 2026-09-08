/**
 * Unified For SLOT — the keyed <For> engine for renderers that engage it.
 *
 * One persistent structure owns both the row bookkeeping AND the node
 * placement for a <For>: an intrusive doubly-linked chain of rows, updated by
 * a prefix/suffix walk plus a middle-window pass (mapArray's own matching,
 * duplicates included) inside an ordinary two-phase render effect, with LIS
 * placement at commit — no mapArray output array, no second DOM diff. The
 * engine implements every For mode itself:
 *
 *   - `keyed` default: rows keyed by item REFERENCE; row fn gets the item
 *     (and an index accessor when its arity asks for one).
 *   - `keyed: false`: rows reused by POSITION; row fn gets an item accessor
 *     and a plain index; tail append/remove only.
 *   - `keyed: fn`: rows keyed by `fn(item)`; row fn gets an item accessor
 *     (and an index accessor by arity).
 *   - duplicates are legal (the second occurrence of a key reuses the second
 *     old row — mapArray's chained index map, per pass).
 *   - `fallback` renders as the empty state, owned like a row.
 *   - a row may render anything: element, primitive, fragment, nothing
 *     (ZERO nodes — neighbor-anchored), or a function (DYNAMIC rows, below).
 *
 * mapArray remains the specification: `For` still returns a callable that
 * runs mapArray for `children()` and renderers that don't engage.
 *
 * DELIVERY (module-graph, no registration): this module rides For's OWN
 * import graph — For stamps `$for.impl` with `unifiedForSlot`, and a
 * renderer's insert() engages it by calling the impl with ITS `SlotOps`
 * singleton (web: `domOps`). The slot is platform-free — every node touch
 * rides the ops.
 *
 * PHASE DISCIPLINE: the COMPUTE half reads, diffs, writes row/index signals
 * (owned writes, mapArray's), and may create fresh rows as DETACHED nodes,
 * but never touches the live document or the committed chain. The EFFECT
 * half is the only writer of both. Under a held transition the effect
 * doesn't run until reveal; a re-compute before the effect discards the
 * superseded plan's fresh rows and diffs again from committed state.
 *
 * ROW OWNERSHIP (mapArray's shape): ONE slot owner under For's CREATION
 * owner (`$for.owner`) — rows inherit context, boundaries and lifetime from
 * where the <For> was written. The insert's cleanup disposes it. Per row:
 * `createOwner()` + `runWithOwner` (untracked + owned).
 *
 * FLAT MODE (create economics): identity-keyed, arity-1 lists — the common
 * shape — fill as parallel arrays (no Row objects, no chain) and materialize
 * the chain lazily on the first partial structural op. Measured +5-10% on
 * 10k create/clear, parity at 1k (2026-09-07). Every other mode is chain
 * from the first fill, so the modes are implemented once.
 *
 * DYNAMIC ROWS (classic's list-effect model): a row whose top level resolves
 * to a FUNCTION is created once (owned, untracked) and RESOLVED by the slot's
 * compute, tracked, every run — the `flatten` read classic's insert effect
 * performs for such rows, moved here. No per-row effect, no marker nodes; a
 * flip splices only that row's range.
 */
import {
  accessor,
  createMemo,
  createOwner,
  createRenderEffect,
  flatten,
  onCleanup,
  runWithOwner,
  setSignal,
  signal
} from "@solidjs/signals";
import { IS_DEV } from "./core.js";

/** HYDRATION HOOKS — installed by enableHydration() (for-slot-hydration.ts),
 * null in CSR bundles so every hydration path here folds away. */
export interface SlotHydration {
  /** Engage-time decision: `false` = not hydrating (normal fill);
   * `{ id }` = hydrating fill with the parity owner id. */
  engage(
    meta: any,
    marker: SlotNode | null | undefined,
    region: SlotNode[] | undefined
  ): { id: string } | false;
  /** Hydrating fill commit: reconcile claimed rows against the region. */
  commitFill(slot: Slot, fp: FlatPlan): void;
}
let slotHydration: SlotHydration | null = null;
export function installSlotHydration(h: SlotHydration): void {
  slotHydration = h;
}

// The two-phase render effect in web's `effect()` shape: transparent + sync.
const transparentOptions = { transparent: true, sync: true } as const;
function effect<T>(fn: (prev?: T) => T, effectFn: (value: T, prev?: T) => void): void {
  createRenderEffect(fn, effectFn, transparentOptions);
}

type RowOwner = { dispose(self?: boolean): void };

/** Renderer node — OPAQUE to the slot (core models no DOM; every node touch
 * rides `SlotOps`). Web binds it to `Node`, universal renderers to theirs. */
export type SlotNode = object;

/** A row's nodes: one, several, or NONE (empty-rendering rows). */
type Nodes = SlotNode | SlotNode[] | null;

export interface Row {
  /** Row key: the item (identity mode), `keyFn(item)`, or unused (by index). */
  k: any;
  /** Row owner (context carrier + disposer). */
  o: RowOwner;
  /** Item signal (accessor-row modes) / index signal (arity ≥ 2), else null. */
  it: any;
  ix: any;
  /** Single-root fast form... */
  n: SlotNode | null;
  /** ...or the fragment form; both null = zero nodes (or unresolved fresh dynamic). */
  ns: SlotNode[] | null;
  /** DYNAMIC row: the unresolved value re-read TRACKED every run; null = static. */
  f: any;
  /** The row fn's RAW result (what mapArray would have mapped to) — the
   * engine's ARRAY output for children()/introspection/non-engaging renderers. */
  v: any;
  p: Row | null;
  x: Row | null;
  /** True once the effect phase has placed the row into live DOM. */
  live: boolean;
  /** Needs placement this commit (fresh or displaced). */
  mv: boolean;
  /** -1 marks a row leaving in the pending plan (dynamic scan skips it). */
  g: number;
}

type Leaves = any[];

interface Plan {
  /** Final row order for the CHANGED middle window only. */
  order: Row[];
  /** Committed rows leaving the list — detach + dispose at commit. */
  removes: Row[];
  /** Chain splice boundaries (null = list edge). */
  before: Row | null;
  after: Row | null;
  /** Chain size after this plan applies. */
  len: number;
  /** Dynamic rows whose resolution changed: splice at commit (chain order). */
  upd: [Row, Leaves][] | null;
  /** Fallback row to show after this plan (null = none). */
  fb: Row | null;
  /** Set when a RESOLUTION throw (NotReady) parked this plan: the target
   * items, so the retry reuses the built rows instead of rebuilding. */
  target?: any[];
}

export interface Flat {
  items: any[];
  owners: RowOwner[];
  nodes: Nodes[];
  /** Dynamic rows' unresolved values by index (null entries = static). */
  fns: any[] | null;
  /** Index signals (arity-2 rows) / item signals (key-fn rows), else null.
   * Flat never UPDATES a signal: any structural op — including a same-key
   * new-object update — materializes the chain first. */
  ixs: any[] | null;
  its: any[] | null;
}

export interface FlatPlan {
  ff: 1;
  mode: "fill" | "replace" | "clear" | "dyn";
  items: any[];
  owners: RowOwner[];
  nodes: Nodes[];
  fns: any[] | null;
  ixs: any[] | null;
  its: any[] | null;
  len: number;
  upd: [number, Leaves][] | null;
  fb: Row | null;
  target?: any[];
}

/** RENDERER OPS — the slot's entire platform surface. */
export interface SlotOps {
  insert(parent: SlotNode, node: SlotNode, anchor: SlotNode | null): void;
  remove(node: SlotNode): void;
  createText(text: string): SlotNode;
  isNode(v: unknown): boolean;
  /** Whole-parent bulk clear (batch-clear / full-replace fast paths). */
  clear(parent: SlotNode): void;
  /** Ownership marker for multi-slot parents (web: `$$SLOT`). */
  tag(node: SlotNode, marker: SlotNode): void;
  /** True when `node` is a direct child of `parent` (ownership guard). */
  contains(parent: SlotNode, node: SlotNode): boolean;
  /** True when `first`/`last` are the parent's first/last children. */
  owns(parent: SlotNode, first: SlotNode, last: SlotNode): boolean;
  /** Next sibling (list-end anchor: classic's contiguity rule). */
  next(node: SlotNode): SlotNode | null;
  /** Text node data, or undefined for non-text nodes (dynamic-row diff). */
  textOf(node: SlotNode): string | undefined;
  /** Write text data if `node` is a text node; false otherwise (commit). */
  setText(node: SlotNode, text: string): boolean;
}

export interface Slot {
  head: Row | null;
  tail: Row | null;
  /** Chain size (rows; the fallback is NOT a chain row). */
  size: number;
  /** Host parent, or null in ARRAY mode (no renderer: the engine answers a
   * plain call with the row values instead of placing nodes). */
  parent: SlotNode | null;
  /** Placement anchor: the end marker, or null (append at parent end). */
  end: SlotNode | null;
  /** True ONLY for whole-parent inserts (marker === undefined). */
  whole: boolean;
  owner: RowOwner;
  flat: Flat | null;
  pending: Plan | FlatPlan | null;
  dead: boolean;
  /** True once any dynamic row was built — gates the per-run resolve scan. */
  dyn: boolean;
  /** Live fallback row (empty list with `fallback`), else null. */
  fb: Row | null;
  /** Renderer ops, or null in ARRAY mode. */
  ops: SlotOps | null;
  /** HYDRATING FILL in progress; cleared by the first commit. Nothing can
   * demote mid-fill, so claims never need handing back. */
  hyd: boolean;
  /** Hydration: the claimed region snapshot. */
  region: SlotNode[] | undefined;
  // ── Mode (from the $for descriptor).
  row: (...args: any[]) => any;
  /** Key function (`keyed: fn`), else undefined. */
  kf: ((item: any) => any) | undefined;
  /** `keyed: false` — positional reuse, item accessor + plain index. */
  bi: boolean;
  /** Rows receive an item ACCESSOR (bi || kf). */
  ac: boolean;
  /** Rows receive an index ACCESSOR (arity ≥ 2, not bi). */
  ixs: boolean;
  fallback: (() => any) | undefined;
}

const pureOptions = { ownedWrite: true };

/** Whole-parent bulk ops (`ops.clear`) are safe only when our window IS the
 * parent's entire child list — classic's ownsAllChildren ruling. */
function ownsParent(slot: Slot): boolean {
  if (!slot.whole || slot.fb !== null || slot.ops === null) return false;
  const first = firstNodeOf(slot);
  const last = lastNodeOf(slot);
  return first !== null && last !== null && slot.ops.owns(slot.parent!, first, last);
}

const firstOf = (nd: Nodes): SlotNode | null =>
  nd === null ? null : Array.isArray(nd) ? nd[0] : nd;
const lastOf = (nd: Nodes): SlotNode | null =>
  nd === null ? null : Array.isArray(nd) ? nd[nd.length - 1] : nd;
const nodesOf = (r: Row): Nodes => (r.n !== null ? r.n : r.ns);

/** First node of the list (skipping zero-node rows), or null when none. */
function firstNodeOf(slot: Slot): SlotNode | null {
  const f = slot.flat;
  if (f !== null) {
    for (let i = 0; i < f.nodes.length; i++) {
      const n = firstOf(f.nodes[i]);
      if (n !== null) return n;
    }
    return null;
  }
  return firstNodeFrom(slot.head);
}
/** Last node of the list (skipping zero-node rows), or null when none. */
function lastNodeOf(slot: Slot): SlotNode | null {
  const f = slot.flat;
  if (f !== null) {
    for (let i = f.nodes.length - 1; i >= 0; i--) {
      const n = lastOf(f.nodes[i]);
      if (n !== null) return n;
    }
    return null;
  }
  for (let r = slot.tail; r !== null; r = r.p) {
    const n = lastOf(nodesOf(r));
    if (n !== null) return n;
  }
  return null;
}
/** First node at or after row `r` in chain order (zero-node rows skipped). */
function firstNodeFrom(r: Row | null): SlotNode | null {
  for (; r !== null; r = r.x) {
    const n = firstOf(nodesOf(r));
    if (n !== null) return n;
  }
  return null;
}

/** The node AFTER the list — classic's contiguity rule (`tail.nextSibling`
 * while the tail is still ours). Falls back to the end marker / parent end.
 * Read at commit start, BEFORE removes. */
function endAnchor(slot: Slot): SlotNode | null {
  const ops = slot.ops;
  if (ops === null) return null;
  const last = lastNodeOf(slot);
  return last !== null && ops.contains(slot.parent!, last) ? ops.next(last) : slot.end;
}

/** Detach only what is still OURS (classic's `parentNode === parent` guard). */
function detach(slot: Slot, n: SlotNode): void {
  const ops = slot.ops;
  if (ops !== null && ops.contains(slot.parent!, n)) ops.remove(n);
}
function detachAll(slot: Slot, nd: Nodes): void {
  if (nd === null) return;
  if (Array.isArray(nd)) for (let i = 0; i < nd.length; i++) detach(slot, nd[i]);
  else detach(slot, nd);
}

/** Insert (fresh) or move (live) a row's nodes before `anchor`. */
function placeNodes(slot: Slot, nd: Nodes, anchor: SlotNode | null, tagIt: boolean): void {
  const ops = slot.ops;
  if (nd === null || ops === null) return;
  const tag = slot.end;
  const parent = slot.parent!;
  if (Array.isArray(nd)) {
    for (let i = 0; i < nd.length; i++) {
      ops.insert(parent, nd[i], anchor);
      if (tag && tagIt) ops.tag(nd[i], tag);
    }
  } else {
    ops.insert(parent, nd, anchor);
    if (tag && tagIt) ops.tag(nd, tag);
  }
}

function removeRow(slot: Slot, r: Row): void {
  if (r.live) detachAll(slot, nodesOf(r));
  r.o.dispose();
}

const FLATTEN_OPTS = { skipNonRendered: true, doNotUnwrap: true } as const;
const RESOLVE_OPTS = { skipNonRendered: true } as const;
const EMPTY: Leaves = [];
const toLeaves = (v: any): Leaves => (v === undefined ? EMPTY : Array.isArray(v) ? v : [v]);

/** Build a row body under its own owner (untracked + owned). Returns the
 * row's nodes (null for a zero-node or DYNAMIC row) and hands the owner and
 * the dynamic value back through `bpOwner` / `bpF` (no per-row tuple — a
 * 10k create is 10k rows). A throw disposes the row's owner. */
let bpOwner: RowOwner = null as unknown as RowOwner;
let bpF: any = null;
let bpV: any = null;
// One shared thunk for the owned row call (no per-row closure): arguments
// travel through module slots. Arity-exact (mapArray passes one argument to
// arity-1 mappers). Reentrancy-safe: the slots are consumed synchronously
// before any nested row build can begin.
let bpFn: (...args: any[]) => any;
let bpA0: any;
let bpA1: any;
const callRow = () => (bpA1 === undefined ? bpFn(bpA0) : bpFn(bpA0, bpA1));
function buildParts(rowFn: (...args: any[]) => any, a0: any, a1: any, ops: SlotOps | null): Nodes {
  const o: RowOwner = (bpOwner = createOwner() as unknown as RowOwner);
  bpF = null;
  let v: any;
  try {
    bpFn = rowFn;
    bpA0 = a0;
    bpA1 = a1;
    bpV = v = runWithOwner(o as any, callRow);
    // ARRAY mode: the raw result IS the output (mapArray parity); no nodes.
    if (ops === null) return null;
    if (ops.isNode(v)) return v as SlotNode;
    const t = typeof v;
    if (t === "string" || t === "number") return ops.createText(String(v));
    if (t === "function") {
      bpF = v; // dynamic: resolved tracked by the caller
      return null;
    }
    v = runWithOwner(o as any, () => flatten(v, FLATTEN_OPTS));
  } catch (e) {
    o.dispose();
    throw e;
  }
  if (typeof v === "function") {
    bpF = v; // resolving wrapper (accessor leaves)
    return null;
  }
  return leavesToNodes(toLeaves(v), ops);
}

/** Resolve a dynamic row's value — classic's tracked `flatten` read. */
function resolve(f: any): Leaves {
  return toLeaves(flatten(f, RESOLVE_OPTS));
}

/** Materialize leaves as DETACHED nodes; none → null (zero-node row). */
function leavesToNodes(leaves: Leaves, ops: SlotOps): Nodes {
  const n = leaves.length;
  if (n === 0) return null;
  if (n === 1) {
    const c = leaves[0];
    return ops.isNode(c) ? (c as SlotNode) : ops.createText(String(c));
  }
  const ns: SlotNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = leaves[i];
    ns[i] = ops.isNode(c) ? (c as SlotNode) : ops.createText(String(c));
  }
  return ns;
}

/** Compute-side diff for a dynamic row: do these leaves already describe
 * the row's current nodes? (node leaves by identity, primitives by text). */
function sameLeaves(leaves: Leaves, cur: Nodes, ops: SlotOps): boolean {
  const n = leaves.length;
  if (cur === null) return n === 0;
  const arr = Array.isArray(cur) ? cur : null;
  if (n !== (arr !== null ? arr.length : 1)) return false;
  for (let i = 0; i < n; i++) {
    const c = arr !== null ? arr[i] : (cur as SlotNode);
    const l = leaves[i];
    if (ops.isNode(l)) {
      if (l !== c) return false;
    } else if (ops.textOf(c) !== String(l)) return false;
  }
  return true;
}

function setNodes(r: Row, nd: Nodes): void {
  if (Array.isArray(nd)) {
    r.n = null;
    r.ns = nd;
  } else {
    r.n = nd;
    r.ns = null;
  }
}

/** Commit-side splice of a dynamic row's range: reuse positional text nodes
 * with a `.data` write, detach what didn't survive (guarded), place the new
 * range before `anchor`. */
function spliceRange(slot: Slot, cur: Nodes, leaves: Leaves, anchor: SlotNode | null): Nodes {
  const ops = slot.ops!; // DOM mode only (array mode never resolves dynamic rows)
  const parent = slot.parent!;
  const arr: SlotNode[] = cur === null ? [] : Array.isArray(cur) ? cur : [cur];
  const n = leaves.length;
  const out: SlotNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const l = leaves[i];
    if (ops.isNode(l)) out[i] = l as SlotNode;
    else {
      const s = String(l);
      const c = arr[i];
      out[i] = c !== undefined && ops.setText(c, s) ? c : ops.createText(s);
    }
  }
  for (let i = 0; i < arr.length; i++) if (out.indexOf(arr[i]) === -1) detach(slot, arr[i]);
  const tag = slot.end;
  for (let i = n - 1; i >= 0; i--) {
    ops.insert(parent, out[i], anchor);
    if (tag) ops.tag(out[i], tag);
    anchor = out[i];
  }
  return n === 0 ? null : n === 1 ? out[0] : out;
}

/** Build a row for `item` at list index `j` in the slot's mode. */
function buildRow(slot: Slot, item: any, j: number, key: any): Row {
  const it = slot.ac ? signal(item, pureOptions) : null;
  const ix = slot.ixs ? signal(j, pureOptions) : null;
  const nd = buildParts(
    slot.row,
    it !== null ? accessor(it) : item,
    slot.bi ? j : ix !== null ? accessor(ix) : undefined,
    slot.ops
  );
  return {
    k: key,
    o: bpOwner,
    it,
    ix,
    n: Array.isArray(nd) ? null : nd,
    ns: Array.isArray(nd) ? nd : null,
    f: bpF,
    v: bpV,
    p: null,
    x: null,
    live: false,
    mv: true,
    g: 0
  };
}

/** Lossless representation change: committed flat arrays → chain. Pure
 * bookkeeping over committed rows (phase-safe); item/index signals carry
 * over and keys are computed now (a first fill never needs them). */
function materialize(slot: Slot): void {
  const f = slot.flat!;
  const kf = slot.kf;
  const n = f.items.length;
  let prev: Row | null = null;
  for (let i = 0; i < n; i++) {
    const nd = f.nodes[i];
    const r: Row = {
      // Keys are computed here, once, when the chain first needs them.
      k: kf !== undefined ? kf(f.items[i]) : f.items[i],
      o: f.owners[i],
      it: f.its !== null ? f.its[i] : null,
      ix: f.ixs !== null ? f.ixs[i] : null,
      n: Array.isArray(nd) ? null : nd,
      ns: Array.isArray(nd) ? nd : null,
      f: f.fns !== null ? f.fns[i] : null,
      v: null, // flat mode is DOM-only; array mode never materializes
      p: prev,
      x: null,
      live: true,
      mv: false,
      g: 0
    };
    if (prev !== null) prev.x = r;
    else slot.head = r;
    prev = r;
  }
  slot.tail = prev;
  slot.size = n;
  slot.flat = null;
}

// LIS scratch (module-level, reused — markMoves runs NO user code).
let lisTails: number[] = [];
let lisTailIdx: number[] = [];
let lisPrev: number[] = [];

/** Mark rows that KEEP their DOM position (LIS of old-middle indices);
 * everything else gets `mv = true`. `oldPos[j]` is -1 for fresh rows. */
function markMoves(order: Row[], oldPos: number[]): void {
  const len = oldPos.length;
  if (lisPrev.length < len) lisPrev = new Array(len);
  let tlen = 0;
  for (let i = 0; i < len; i++) {
    const v = oldPos[i];
    if (v === -1) continue;
    let lo = 0,
      hi = tlen;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lisTails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    lisTails[lo] = v;
    lisPrev[i] = lo > 0 ? lisTailIdx[lo - 1] : -1;
    lisTailIdx[lo] = i;
    if (lo === tlen) tlen++;
  }
  for (let i = 0; i < len; i++) if (oldPos[i] !== -1) order[i].mv = true;
  let at = tlen > 0 ? lisTailIdx[tlen - 1] : -1;
  while (at !== -1) {
    order[at].mv = false;
    at = lisPrev[at];
  }
}

const IDENTICAL = 0 as const;
type ComputeOut = Plan | FlatPlan | typeof IDENTICAL;

function sameItems(a: ArrayLike<any>, b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The engine: row bookkeeping for one <For>, in every mode. Two outputs
 * share it — DOM placement (a renderer's insert() engaged it with its ops)
 * and ARRAY output (`ops === null`: a plain call of the For accessor, the
 * mapArray-shaped result for children()/introspection/renderers that don't
 * engage). Returns the compute/commit halves and the array reader. */
function engine(
  meta: any,
  parent: SlotNode | null,
  marker: SlotNode | null | undefined,
  ops: SlotOps | null,
  region: SlotNode[] | undefined,
  hole: boolean,
  ownerOpts: { id: string } | undefined,
  hyd: boolean
) {
  const kf = typeof meta.keyed === "function" ? meta.keyed : undefined;
  const bi = meta.keyed === false;
  const slot: Slot = {
    head: null,
    tail: null,
    size: 0,
    parent,
    end: marker ?? null,
    whole: marker === undefined,
    // Slot owner under For's CREATION owner — where mapArray's internal
    // owner lives — so rows see the context, boundaries and lifetime of the
    // <For>'s source position. Under hydration it takes the parity id.
    owner: runWithOwner(meta.owner, () => createOwner(ownerOpts)) as unknown as RowOwner,
    flat: null,
    pending: null,
    dead: false,
    dyn: false,
    fb: null,
    ops,
    hyd,
    region,
    row: meta.row,
    kf,
    bi,
    ac: bi || kf !== undefined,
    ixs: meta.row.length > 1 && !bi,
    fallback: meta.fallback
  };
  // Flat mode covers every keyed mode (identity and key-fn rows, with or
  // without an index accessor); only keyed:false (positional) is chain-first.
  // Array mode is chain-only (its output walks the chain).
  const flatOk = !slot.bi && ops !== null;
  const keyOf = kf !== undefined ? kf : (item: any) => item;

  const dropPending = (): void => {
    const p = slot.pending;
    if (p !== null) {
      if ((p as FlatPlan).ff === 1) {
        const { owners } = p as FlatPlan;
        for (let j = 0; j < owners.length; j++) owners[j].dispose();
      } else {
        const { order, removes } = p as Plan;
        for (let j = 0; j < order.length; j++) if (!order[j].live) order[j].o.dispose();
        for (let j = 0; j < removes.length; j++) removes[j].g = 0;
      }
      if (p.fb !== null && p.fb !== slot.fb) p.fb.o.dispose();
      slot.pending = null;
    }
  };

  const removeFlatDom = (): void => {
    const f = slot.flat!;
    if (ownsParent(slot)) ops!.clear(slot.parent!);
    else for (let i = 0; i < f.nodes.length; i++) detachAll(slot, f.nodes[i]);
  };

  /** Resolve the fresh dynamic rows of a plan (tracked). */
  const resolveFreshFlat = (fp: FlatPlan): void => {
    const fns = fp.fns!;
    for (let j = 0; j < fns.length; j++)
      if (fns[j] !== null) fp.nodes[j] = leavesToNodes(resolve(fns[j]), ops!);
  };
  const resolveFreshRows = (order: Row[], fb: Row | null): void => {
    for (let j = 0; j < order.length; j++) {
      const r = order[j];
      if (!r.live && r.f !== null) setNodes(r, leavesToNodes(resolve(r.f), ops!));
    }
    if (fb !== null && !fb.live && fb.f !== null) setNodes(fb, leavesToNodes(resolve(fb.f), ops!));
  };

  /** The fallback row for an empty list (built owned, like a row). */
  const buildFallback = (): Row => {
    const nd = buildParts(slot.fallback!, undefined, undefined, ops);
    return {
      k: null,
      o: bpOwner,
      it: null,
      ix: null,
      n: Array.isArray(nd) ? null : nd,
      ns: Array.isArray(nd) ? nd : null,
      f: bpF,
      v: bpV,
      p: null,
      x: null,
      live: false,
      mv: true,
      g: 0
    };
  };

  /** Build the flat arrays for `itemsSnap` (identity rows). */
  const buildFlat = (itemsSnap: any[], mode: "fill" | "replace"): FlatPlan => {
    const len = itemsSnap.length;
    const owners: RowOwner[] = new Array(len);
    const nodes: Nodes[] = new Array(len);
    const ixs: any[] | null = slot.ixs ? new Array(len) : null;
    const its: any[] | null = slot.ac ? new Array(len) : null;
    let fns: any[] | null = null;
    const fp: FlatPlan = {
      ff: 1,
      mode,
      items: itemsSnap,
      owners,
      nodes,
      fns,
      ixs,
      its,
      len,
      upd: null,
      fb: null
    };
    try {
      runWithOwner(slot.owner as any, () => {
        for (let j = 0; j < len; j++) {
          let a0: any = itemsSnap[j];
          let a1: any;
          if (its !== null) a0 = accessor((its[j] = signal(a0, pureOptions)));
          if (ixs !== null) a1 = accessor((ixs[j] = signal(j, pureOptions)));
          const nd = buildParts(slot.row, a0, a1, ops);
          owners[j] = bpOwner;
          if (bpF !== null) {
            if (fns === null) fns = new Array(len).fill(null);
            fns[j] = bpF;
          } else nodes[j] = nd;
        }
      });
      if (fns !== null) {
        // Dynamic rows: initial resolution, TRACKED (outside the owner
        // wrapper). Park first so a NotReady keeps the built rows.
        slot.dyn = true;
        fp.fns = fns;
        fp.target = itemsSnap;
        slot.pending = fp;
        resolveFreshFlat(fp);
      }
    } catch (e) {
      // A throw mid-BUILD (untracked, mapArray parity): dispose the rows
      // built so far. A throw from RESOLUTION (fp is parked) keeps them.
      if (slot.pending !== fp) for (let d = 0; d < len; d++) owners[d]?.dispose();
      throw e;
    }
    return fp;
  };

  /** Chain fill from empty: every row fresh (non-flat modes, or after a
   * fallback). Removes carry the fallback row, if shown. */
  const fillChain = (arr: ArrayLike<any>, removes: Row[]): Plan => {
    const len = arr.length;
    // Read the items TRACKED before entering the owner wrapper (reads inside
    // runWithOwner are untracked — a store index write must re-run us).
    const snap: any[] = new Array(len);
    for (let j = 0; j < len; j++) snap[j] = arr[j];
    const order: Row[] = new Array(len);
    let anyDyn = false;
    try {
      runWithOwner(slot.owner as any, () => {
        for (let j = 0; j < len; j++) {
          const item = snap[j];
          const built = buildRow(slot, item, j, keyOf(item));
          if (built.f !== null) anyDyn = true;
          order[j] = built;
        }
      });
    } catch (e) {
      for (let j = 0; j < len; j++) order[j]?.o.dispose();
      throw e;
    }
    const plan: Plan = (slot.pending = {
      order,
      removes,
      before: null,
      after: null,
      len,
      upd: null,
      fb: null
    });
    if (anyDyn) {
      slot.dyn = true;
      plan.target = snap;
      resolveFreshRows(order, null);
    }
    return plan;
  };

  /** Re-read every committed dynamic row (tracked — keeps the subscription
   * alive, classic's per-run flatten) and collect the changed ones. Rows
   * leaving in the pending plan (g === -1) skip. */
  const scanChain = (): [Row, Leaves][] | null => {
    let upd: [Row, Leaves][] | null = null;
    for (let r = slot.head; r !== null; r = r.x) {
      if (r.f === null || r.g === -1) continue;
      const leaves = resolve(r.f);
      if (!sameLeaves(leaves, nodesOf(r), ops!)) (upd ??= []).push([r, leaves]);
    }
    const fb = slot.fb;
    if (fb !== null && fb.f !== null && fb.g !== -1) {
      const leaves = resolve(fb.f);
      if (!sameLeaves(leaves, nodesOf(fb), ops!)) (upd ??= []).push([fb, leaves]);
    }
    return upd;
  };
  const scanFlat = (): [number, Leaves][] | null => {
    const f = slot.flat!;
    const fns = f.fns;
    if (fns === null) return null;
    let upd: [number, Leaves][] | null = null;
    for (let j = 0; j < fns.length; j++) {
      if (fns[j] === null) continue;
      const leaves = resolve(fns[j]);
      if (!sameLeaves(leaves, f.nodes[j], ops!)) (upd ??= []).push([j, leaves]);
    }
    return upd;
  };

  /** DOM mode teardown (registered by the engaging insert's cleanup): the
   * slot owner lives under For's creation owner, so dispose it explicitly.
   * HOLE mode also removes the nodes — the hosting effect re-fills the parent. */
  const teardown = (): void => {
    slot.dead = true;
    if (hole) {
      if (slot.flat !== null) removeFlatDom();
      else for (let r = slot.head; r !== null; r = r.x) detachAll(slot, nodesOf(r));
      if (slot.fb !== null) detachAll(slot, nodesOf(slot.fb));
    }
    slot.owner.dispose();
  };

  /** All committed chain rows, as a removes list. */
  const allRows = (): Row[] => {
    const out: Row[] = [];
    for (let r = slot.head; r !== null; r = r.x) {
      r.g = -1;
      out.push(r);
    }
    return out;
  };

  /** Structural half of the compute: items → plan (or IDENTICAL). */
  const structural = (arr: ArrayLike<any>): ComputeOut => {
    const len = arr.length;
    // A plan parked by a resolution throw whose target still matches: reuse
    // its built rows (no rebuild, no re-invocation) and re-resolve.
    const parked = slot.pending;
    if (parked !== null && parked.target !== undefined && sameItems(arr, parked.target)) {
      if ((parked as FlatPlan).ff === 1) resolveFreshFlat(parked as FlatPlan);
      else resolveFreshRows((parked as Plan).order, parked.fb);
      return parked;
    }
    dropPending();
    // ── FALLBACK: the empty state, when the list has one.
    if (len === 0 && slot.fallback !== undefined) {
      if (slot.fb !== null) return IDENTICAL;
      let removes: Row[];
      if (slot.flat !== null) {
        // Leave flat mode through the chain (rare: clear-to-fallback).
        materialize(slot);
      }
      removes = allRows();
      // Owned like a row: under the slot owner (context, boundaries, and the
      // hydration id chain — mapArray renders its fallback there too).
      const fb = runWithOwner(slot.owner as any, buildFallback) as Row;
      const plan: Plan = (slot.pending = {
        order: [],
        removes,
        before: null,
        after: null,
        len: 0,
        upd: null,
        fb
      });
      if (fb.f !== null) {
        slot.dyn = true;
        plan.target = [];
        resolveFreshRows(plan.order, fb);
      }
      return plan;
    }
    const fbCur = slot.fb;
    if (fbCur !== null) {
      // Items arrived over the fallback: drop it, fill fresh (chain).
      fbCur.g = -1;
      return fillChain(arr, [fbCur]);
    }
    // ── FLAT MODE (identity arity-1 lists): aligned lists stay flat (zero
    // work); clears and no-survivor replaces stay flat (bulk swap); only a
    // PARTIAL structural op materializes the chain.
    if (slot.flat !== null) {
      const fi = slot.flat.items;
      if (len === fi.length && sameItems(arr, fi)) return IDENTICAL;
      if (len === 0)
        return (slot.pending = {
          ff: 1,
          mode: "clear",
          items: [],
          owners: [],
          nodes: [],
          fns: null,
          ixs: null,
          its: null,
          len: 0,
          upd: null,
          fb: null
        });
      // Survivors are judged by KEY (a key-fn list re-minting its objects
      // keeps every row; the chain's prefix walk then writes the item
      // signals). The aligned check above is identity-based on purpose: a
      // same-key/new-object update is a structural op for flat mode.
      let survivor = false;
      {
        const old = new Set<any>();
        for (let j = 0; j < fi.length; j++) old.add(kf !== undefined ? kf(fi[j]) : fi[j]);
        for (let j = 0; j < len; j++)
          if (old.has(kf !== undefined ? kf(arr[j]) : arr[j])) {
            survivor = true;
            break;
          }
      }
      if (!survivor) {
        const snap: any[] = new Array(len);
        for (let j = 0; j < len; j++) snap[j] = arr[j];
        return (slot.pending = buildFlat(snap, "replace"));
      }
      materialize(slot);
    }
    // ── FILL from empty.
    if (slot.head === null) {
      if (len === 0) {
        if (!slot.hyd) return IDENTICAL;
        // Empty hydrating fill still commits: clears the hydration state
        // and removes any server rows the client no longer has.
        return (slot.pending = {
          ff: 1,
          mode: "fill",
          items: [],
          owners: [],
          nodes: [],
          fns: null,
          ixs: null,
          its: null,
          len: 0,
          upd: null,
          fb: null
        });
      }
      if (flatOk) {
        const snap: any[] = new Array(len);
        for (let j = 0; j < len; j++) snap[j] = arr[j];
        return (slot.pending = buildFlat(snap, "fill"));
      }
      return fillChain(arr, []);
    }
    // ── BY INDEX (`keyed: false`): positional reuse, tail append/remove.
    if (slot.bi) {
      const size = slot.size;
      const common = len < size ? len : size;
      let r: Row | null = slot.head;
      for (let j = 0; j < common; j++, r = r!.x) setSignal(r!.it, arr[j]);
      if (len === size) return IDENTICAL;
      if (len > size) {
        const tail: any[] = new Array(len - size);
        for (let j = size; j < len; j++) tail[j - size] = arr[j]; // tracked reads
        const order: Row[] = new Array(len - size);
        let anyDyn = false;
        try {
          runWithOwner(slot.owner as any, () => {
            for (let j = size; j < len; j++) {
              const built = buildRow(slot, tail[j - size], j, null);
              if (built.f !== null) anyDyn = true;
              order[j - size] = built;
            }
          });
        } catch (e) {
          for (let j = 0; j < order.length; j++) order[j]?.o.dispose();
          throw e;
        }
        const plan: Plan = (slot.pending = {
          order,
          removes: [],
          before: slot.tail,
          after: null,
          len,
          upd: null,
          fb: null
        });
        if (anyDyn) {
          slot.dyn = true;
          plan.target = Array.prototype.slice.call(arr);
          resolveFreshRows(order, null);
        }
        return plan;
      }
      // Shrink: rows from position `len` leave.
      const removes: Row[] = [];
      for (let q: Row | null = r; q !== null; q = q.x) {
        q.g = -1;
        removes.push(q);
      }
      return (slot.pending = {
        order: [],
        removes,
        before: r!.p,
        after: null,
        len,
        upd: null,
        fb: null
      });
    }
    // ── KEYED (identity / key fn): prefix walk.
    let cursor: Row | null = slot.head;
    let i = 0;
    while (cursor !== null && i < len && cursor.k === (kf !== undefined ? kf(arr[i]) : arr[i])) {
      if (slot.ac) setSignal(cursor.it, arr[i]);
      cursor = cursor.x;
      i++;
    }
    if (i === len && cursor === null) return IDENTICAL;
    const before = cursor === null ? slot.tail : cursor.p; // last prefix row
    // ── Suffix walk.
    let tailCursor = slot.tail;
    let end = len - 1;
    let oldRemain = slot.size - i;
    const dif = len - slot.size;
    while (
      tailCursor !== null &&
      oldRemain > 0 &&
      end >= i &&
      tailCursor.k === (kf !== undefined ? kf(arr[end]) : arr[end])
    ) {
      if (slot.ac) setSignal(tailCursor.it, arr[end]);
      if (slot.ixs && dif !== 0) setSignal(tailCursor.ix, end);
      tailCursor = tailCursor.p;
      end--;
      oldRemain--;
    }
    const after = oldRemain === 0 ? cursor : tailCursor!.x; // first suffix row
    // ── Middle window: new keys → positions (chained for duplicates,
    // scanning backwards so occurrences pair up in natural order — mapArray's
    // own matching), then old middle rows claim their new positions.
    const width = end - i + 1;
    // Read the window TRACKED, before entering the owner wrapper (reads
    // inside runWithOwner are untracked; a pending store write would tear).
    const midItems: any[] = new Array(width);
    for (let j = 0; j < width; j++) midItems[j] = arr[i + j];
    const keys: any[] = kf !== undefined ? new Array(width) : midItems;
    const newIndices = new Map<any, number>();
    const newNext: number[] = new Array(width);
    for (let j = width - 1; j >= 0; j--) {
      const key = kf !== undefined ? (keys[j] = kf(midItems[j])) : midItems[j];
      const prev = newIndices.get(key);
      newNext[j] = prev === undefined ? -1 : prev;
      newIndices.set(key, j);
    }
    const order: Row[] = new Array(width);
    const oldPos: number[] = new Array(width);
    const removes: Row[] = [];
    {
      let r: Row | null = cursor;
      for (let c = 0; c < oldRemain; c++, r = r!.x) {
        const row = r!;
        const j = newIndices.get(row.k);
        if (j !== undefined && j !== -1) {
          order[j] = row;
          oldPos[j] = c;
          newIndices.set(row.k, newNext[j]);
        } else {
          row.g = -1;
          removes.push(row);
        }
      }
    }
    // ── Reused rows: write item/index signals; fresh rows: build (owned).
    let fresh = 0;
    let anyDyn = false;
    try {
      runWithOwner(slot.owner as any, () => {
        for (let j = 0; j < width; j++) {
          const row = order[j];
          if (row !== undefined) {
            if (slot.ac) setSignal(row.it, midItems[j]);
            if (slot.ixs) setSignal(row.ix, i + j);
          } else {
            const built = buildRow(slot, midItems[j], i + j, keys[j]);
            if (built.f !== null) anyDyn = true;
            fresh++;
            order[j] = built;
            oldPos[j] = -1;
          }
        }
      });
    } catch (e) {
      // A row fn threw mid-BUILD: fresh rows chain to the PERSISTENT slot
      // owner and would leak until slot death — dispose before the throw
      // rides the boundary; leaving rows stay committed (un-mark them).
      for (let j = 0; j < width; j++) {
        const r = order[j];
        if (r !== undefined && !r.live) r.o.dispose();
      }
      for (let j = 0; j < removes.length; j++) removes[j].g = 0;
      throw e;
    }
    markMoves(order, oldPos);
    const plan: Plan = (slot.pending = { order, removes, before, after, len, upd: null, fb: null });
    if (anyDyn) {
      slot.dyn = true;
      plan.target = width === len ? midItems : Array.prototype.slice.call(arr);
      resolveFreshRows(order, null);
    }
    return plan;
  };

  const compute = (): ComputeOut => {
    if (slot.dead) return IDENTICAL;
    // Read FIRST (phase separation): a NotReady here leaves the slot
    // untouched and rides the boundary like any compute throw. Array-likes
    // are accepted the way mapArray duck-types them.
    const items = meta.each();
    const arr: ArrayLike<any> = items == null || items === false ? EMPTY : items;
    const out = structural(arr);
    if (!slot.dyn) return out;
    // ── Dynamic rows: re-read every committed one (keeps the subscription
    // alive) and attach the changed ranges.
    if (out === IDENTICAL) {
      if (slot.flat !== null) {
        const upd = scanFlat();
        if (upd === null) return IDENTICAL;
        const f = slot.flat;
        return (slot.pending = {
          ff: 1,
          mode: "dyn",
          items: f.items,
          owners: [],
          nodes: f.nodes,
          fns: f.fns,
          ixs: f.ixs,
          its: f.its,
          len: f.items.length,
          upd,
          fb: slot.fb
        });
      }
      const upd = scanChain();
      if (upd === null) return IDENTICAL;
      return (slot.pending = {
        order: [],
        removes: [],
        before: slot.tail,
        after: null,
        len: slot.size,
        upd,
        fb: slot.fb
      });
    }
    if ((out as FlatPlan).ff !== 1) (out as Plan).upd = scanChain();
    return out;
  };

  const commit = (out: ComputeOut): void => {
    if (out === IDENTICAL) return;
    if (out !== slot.pending) return; // superseded mid-flight
    slot.pending = null;
    // The node after the list, read BEFORE removes.
    const endA = endAnchor(slot);
    // Fallback leaving: detach + dispose before anything is placed.
    const fbOld = slot.fb;
    if (fbOld !== null && out.fb !== fbOld) {
      detachAll(slot, nodesOf(fbOld));
      fbOld.o.dispose();
      slot.fb = null;
    }
    if ((out as FlatPlan).ff === 1) {
      const fp = out as FlatPlan;
      if (fp.mode === "dyn") {
        const f = slot.flat!;
        const upd = fp.upd!;
        for (let u = upd.length - 1; u >= 0; u--) {
          const j = upd[u][0];
          let anchor: SlotNode | null = null;
          for (let q = j + 1; q < f.nodes.length && anchor === null; q++)
            anchor = firstOf(f.nodes[q]);
          if (anchor === null) anchor = endA;
          f.nodes[j] = spliceRange(slot, f.nodes[j], upd[u][1], anchor);
        }
        return;
      }
      if (fp.mode === "clear") {
        removeFlatDom();
        const f = slot.flat!;
        for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
        slot.flat = null;
        slot.size = 0;
        slot.dyn = false;
        if (IS_DEV) __unifiedForStats.batchCleared++;
        return;
      }
      if (fp.mode === "replace") {
        removeFlatDom();
        const f = slot.flat!;
        for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
        slot.dyn = fp.fns !== null;
      }
      // Hydrating fill: a claim pass, not a placement pass.
      if (slot.hyd) return slotHydration!.commitFill(slot, fp);
      for (let i = 0; i < fp.nodes.length; i++) placeNodes(slot, fp.nodes[i], endA, true);
      slot.flat = {
        items: fp.items,
        owners: fp.owners,
        nodes: fp.nodes,
        fns: fp.fns,
        ixs: fp.ixs,
        its: fp.its
      };
      slot.size = fp.len;
      return;
    }
    const plan = out as Plan;
    const { order, removes, before, after } = plan;
    // Batch clear: N→0 on an OWNED whole-parent slot is one `textContent = ''`
    // + one bulk owner dispose.
    if (
      plan.len === 0 &&
      plan.fb === null &&
      before === null &&
      after === null &&
      ownsParent(slot)
    ) {
      if (IS_DEV) __unifiedForStats.batchCleared++;
      ops!.clear(slot.parent!);
      slot.owner.dispose(false);
      slot.head = slot.tail = null;
      slot.size = 0;
      slot.dyn = false;
      return;
    }
    // Full replace (no survivors, owned whole parent): one bulk detach.
    if (
      before === null &&
      after === null &&
      removes.length === slot.size &&
      removes.length > 0 &&
      ownsParent(slot)
    ) {
      ops!.clear(slot.parent!);
      for (let j = 0; j < removes.length; j++) {
        removes[j].live = false;
        removes[j].o.dispose();
      }
    } else {
      for (let j = 0; j < removes.length; j++) removeRow(slot, removes[j]);
    }
    // Place fresh/moved rows back-to-front so anchors are always final.
    // Direct insertBefore per row, deliberately — NOT fragment-batched runs
    // (browsers charge per MOVE; LIS + direct placement is move-minimal).
    let anchor: SlotNode | null = after !== null ? firstNodeFrom(after) : null;
    if (anchor === null) anchor = endA;
    const hydrating = slot.hyd;
    for (let j = order.length - 1; j >= 0; j--) {
      const r = order[j];
      const first = firstOf(nodesOf(r));
      if (r.mv) {
        // Hydrating fill (chain modes): rows whose templates CLAIMED server
        // nodes are already in place — a claim pass, not a placement pass.
        if (!(hydrating && first !== null && ops!.contains(slot.parent!, first)))
          placeNodes(slot, nodesOf(r), anchor, !r.live);
        r.live = true;
        r.mv = false;
      }
      if (first !== null) anchor = first;
    }
    slot.hyd = false;
    // Splice the chain: [before] → order… → [after].
    let prev = before;
    for (let j = 0; j < order.length; j++) {
      const r = order[j];
      r.p = prev;
      if (prev !== null) prev.x = r;
      else slot.head = r;
      prev = r;
    }
    if (prev !== null) prev.x = after;
    else slot.head = after;
    if (after !== null) after.p = prev;
    else slot.tail = prev;
    slot.size = plan.len;
    // Fallback arriving: place after the (now empty) list.
    const fb = plan.fb;
    if (fb !== null && fb !== fbOld) {
      placeNodes(slot, nodesOf(fb), endA, true);
      fb.live = true;
      fb.mv = false;
      slot.fb = fb;
    }
    // Dynamic rows whose resolution changed: splice each range, back to
    // front so a row's anchor (its successor's first node) is final.
    const upd = plan.upd;
    if (upd !== null)
      for (let u = upd.length - 1; u >= 0; u--) {
        const r = upd[u][0];
        let a: SlotNode | null = r === slot.fb ? endA : firstNodeFrom(r.x);
        if (a === null) a = endA;
        setNodes(r, spliceRange(slot, nodesOf(r), upd[u][1], a));
      }
  };

  /** ARRAY output: the raw row values in order (mapArray's mapped array);
   * an empty list with a fallback yields `[fallback]`. */
  const values = (): any[] => {
    if (slot.fb !== null) return [slot.fb.v];
    const out: any[] = new Array(slot.size);
    let i = 0;
    for (let r = slot.head; r !== null; r = r.x) out[i++] = r.v;
    return out;
  };

  return { compute, commit, values, teardown };
}

/** DOM output — For stamps this as `$for.impl`; a renderer's insert()
 * engages it with its SlotOps. */
export function unifiedForSlot(
  parent: SlotNode,
  listFn: any,
  marker: SlotNode | null | undefined,
  ops: SlotOps,
  region?: SlotNode[],
  /** HOLE mode: engaged from inside a wrapper insert's compute (the
   * `{props.children}` seam). The hosting effect owns the hole, so this
   * slot removes its rows on cleanup (a children change or dispose) — in
   * direct mode the parent element's removal covers that for free. */
  hole = false
): void {
  const meta = listFn.$for;
  // HYDRATION: decided by the installed hooks (null in CSR bundles). A
  // hydrating engage hands back the parity owner id so the slot's rows mint
  // the same hydration keys classic's would.
  let ownerOpts: { id: string } | undefined;
  let hyd = false;
  if (slotHydration !== null) {
    const h = slotHydration.engage(meta, marker, region);
    if (h !== false) {
      ownerOpts = h;
      hyd = true;
    }
  }
  const e = engine(meta, parent, marker, ops, region, hole, ownerOpts, hyd);
  if (IS_DEV) __unifiedForStats.engaged++;
  onCleanup(e.teardown);
  effect(e.compute, e.commit);
}

/** ARRAY output — what a plain call of the For accessor returns: a memo of
 * the row values with mapArray's exact contract (same array identity while
 * the list is structurally unchanged; `[fallback]` when empty with one).
 * Commits inline, like mapArray, so rows are created and disposed in the
 * compute. Created lazily under For's owner on the first read. */
export function unifiedForArray(meta: any): () => any[] {
  const e = engine(
    meta,
    null,
    undefined,
    null,
    undefined,
    false,
    meta.hid !== undefined ? { id: meta.hid } : undefined,
    false
  );
  let last: any[] | undefined;
  return runWithOwner(meta.owner, () =>
    createMemo((): any[] => {
      const out = e.compute();
      if (out === IDENTICAL && last !== undefined) return last;
      e.commit(out);
      return (last = e.values());
    })
  ) as () => any[];
}

/** DEV-ONLY probes: engagement / batch-clear counters, exposed as
 * `DEV.unifiedFor`. */
export interface UnifiedForStats {
  engaged: number;
  batchCleared: number;
}
export const __unifiedForStats: UnifiedForStats = { engaged: 0, batchCleared: 0 };
