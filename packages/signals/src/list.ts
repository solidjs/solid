/**
 * The LIST ENGINE — row bookkeeping for a keyed list, in every mode, with two
 * outputs sharing one implementation:
 *
 *   - ARRAY output (`mapArray`, and a plain call of a `<For>` accessor): a
 *     memo of the row values — the mapped array, same identity while the
 *     list is structurally unchanged, `[fallback]` when empty with one.
 *   - RENDERED output (`<For>` engaged by a renderer): rows are placed and
 *     moved as nodes, through a NODE LAYER the renderer hands in. The engine
 *     itself never touches a node: `ListNodeLayer` is the whole surface, and
 *     when it is `null` (array output) nothing node-related is referenced —
 *     mapArray-only consumers never load a node layer.
 *
 * Modes (mapArray's contract, unchanged):
 *   - `keyed` default: rows keyed by item REFERENCE; row fn gets the item
 *     (and an index accessor when its arity asks for one).
 *   - `keyed: false`: rows reused by POSITION; row fn gets an item accessor
 *     and a plain index; tail append/remove only.
 *   - `keyed: fn`: rows keyed by `fn(item)`; row fn gets an item accessor
 *     (and an index accessor by arity).
 *   - duplicates are legal (the second occurrence of a key reuses the second
 *     old row — the chained index map, per pass).
 *   - `fallback` renders as the empty state, owned like a row.
 *
 * STRUCTURE: an intrusive doubly-linked chain of rows, updated by a
 * prefix/suffix walk plus a middle-window pass, with an LIS at commit for
 * move-minimal placement. FLAT MODE (create economics): keyed lists fill as
 * parallel arrays (no Row objects, no chain) and materialize the chain lazily
 * on the first partial structural op — measured +5-10% on 10k create/clear,
 * parity at 1k (2026-09-07). Array output and `keyed: false` are chain-only.
 *
 * PHASE DISCIPLINE (rendered output): the COMPUTE half reads, diffs, writes
 * row/index signals (owned writes), and may create fresh rows as DETACHED
 * nodes, but never touches the live document or the committed chain; the
 * EFFECT half is the only writer of both. Under a held transition the effect
 * doesn't run until reveal; a re-compute before the effect discards the
 * superseded plan's fresh rows and diffs again from committed state. Array
 * output commits inline (a memo), as mapArray always has.
 *
 * ROW OWNERSHIP: ONE list owner under the list's CREATION owner; rows inherit
 * context, boundaries and lifetime from where the list was written. Untracked
 * reads inside row bodies resolve via `_parentComputed` = the list's own
 * computation, so store lookups see pending writes.
 *
 * DYNAMIC ROWS (rendered output; classic's list-effect model): a row whose
 * top level resolves to a FUNCTION is created once (owned, untracked) and
 * RESOLVED by the engine's compute, tracked, every run. No per-row effect,
 * no marker nodes; a flip splices only that row's range.
 */
import {
  computed,
  createOwner,
  runWithOwner,
  setSignal,
  signal,
  type Owner
} from "./core/index.js";
import { setStrictRead } from "./core/core.js";
import { CONFIG_AUTO_DISPOSE } from "./core/constants.js";
import { accessor, type Accessor } from "./signals.js";
import { $TRACK } from "./store/index.js";

/** Renderer node — OPAQUE to the engine (every node touch rides the layer). */
export type ListNode = object;
/** A row's nodes: one, several, or NONE (empty-rendering rows). */
export type Nodes = ListNode | ListNode[] | null;
export type Leaves = any[];

type RowOwner = { dispose(self?: boolean): void; _parentComputed?: any };

export interface ListRow {
  /** Row key: the item (identity mode), `keyFn(item)`, or unused (by index). */
  k: any;
  o: RowOwner;
  /** Item signal (accessor-row modes) / index signal (arity ≥ 2), else null. */
  it: any;
  ix: any;
  /** Single-root fast form... */
  n: ListNode | null;
  /** ...or the fragment form; both null = zero nodes (or unresolved fresh dynamic). */
  ns: ListNode[] | null;
  /** DYNAMIC row: the unresolved value re-read TRACKED every run; null = static. */
  f: any;
  /** The row fn's RAW result — the ARRAY output. */
  v: any;
  p: ListRow | null;
  x: ListRow | null;
  /** True once placed (rendered) / committed (array). */
  live: boolean;
  /** Needs placement this commit (fresh or displaced). */
  mv: boolean;
  /** -1 marks a row leaving in the pending plan (dynamic scan skips it). */
  g: number;
}

export interface ListPlan {
  order: ListRow[];
  removes: ListRow[];
  before: ListRow | null;
  after: ListRow | null;
  len: number;
  upd: [ListRow, Leaves][] | null;
  fb: ListRow | null;
  /** Set when a RESOLUTION throw (NotReady) parked this plan: the target
   * items, so the retry reuses the built rows instead of rebuilding. */
  target?: any[];
}

export interface ListFlat {
  items: any[];
  owners: RowOwner[];
  nodes: Nodes[];
  fns: any[] | null;
  ixs: any[] | null;
  its: any[] | null;
}

export interface ListFlatPlan {
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
  fb: ListRow | null;
  target?: any[];
}

/** The list descriptor (`<For>` stamps it on its accessor as `$for`). */
export interface ListMeta {
  each: () => any;
  row: (...args: any[]) => any;
  keyed?: boolean | ((item: any) => any);
  fallback?: () => any;
  /** Creation owner: rows live under it. */
  owner: Owner | null;
  /** Hydration only: the explicit id the row parent takes. */
  hid?: string;
  /** Dev: strict-read name for row bodies. */
  name?: string;
  /** @internal defer the first pass to the first read. */
  lazy?: boolean;
}

/** THE NODE LAYER — everything that touches renderer nodes. A renderer
 * builds one over its own primitives (web: DOM; universal: `createRenderer`
 * ops) and hands it to the engine. `null` = array output. */
export interface ListNodeLayer {
  /** Turn a row fn's raw result into nodes under the row owner (flatten
   * fragments there). A FUNCTION-valued result is a DYNAMIC row: return null
   * and report the value through `dynamic()`. */
  build(v: any, o: RowOwner): Nodes;
  /** The dynamic value recorded by the last `build()`, or null. */
  dynamic(): any;
  /** Resolve a dynamic value to leaves — TRACKED (the classic flatten read). */
  resolve(f: any): Leaves;
  toNodes(leaves: Leaves): Nodes;
  same(leaves: Leaves, cur: Nodes): boolean;
  /** Commit-side splice of a dynamic row's range before `anchor`. */
  splice(slot: ListSlot, cur: Nodes, leaves: Leaves, anchor: ListNode | null): Nodes;
  place(slot: ListSlot, nd: Nodes, anchor: ListNode | null, tagIt: boolean): void;
  detach(slot: ListSlot, nd: Nodes): void;
  /** The node after the list (contiguity anchor), read BEFORE removes. */
  endAnchor(slot: ListSlot): ListNode | null;
  /** True when the list is the parent's whole child list (bulk clears). */
  ownsParent(slot: ListSlot): boolean;
  clear(slot: ListSlot): void;
  /** True when `node` is a direct child of the parent (hydration placement). */
  inParent(slot: ListSlot, node: ListNode): boolean;
  /** Hydrating fill commit (claim pass), or null when not hydrating. */
  commitFill: ((slot: ListSlot, fp: ListFlatPlan) => void) | null;
}

export interface ListSlot {
  head: ListRow | null;
  tail: ListRow | null;
  /** Chain size (rows; the fallback is NOT a chain row). */
  size: number;
  /** Host parent (rendered) or null (array). */
  parent: ListNode | null;
  /** Placement anchor: the end marker, or null (append at parent end). */
  end: ListNode | null;
  /** True ONLY for whole-parent inserts (marker === undefined). */
  whole: boolean;
  owner: RowOwner;
  flat: ListFlat | null;
  pending: ListPlan | ListFlatPlan | null;
  dead: boolean;
  /** True once any dynamic row was built — gates the per-run resolve scan. */
  dyn: boolean;
  /** Live fallback row, else null. */
  fb: ListRow | null;
  /** Node layer, or null for array output. */
  layer: ListNodeLayer | null;
  /** HYDRATING FILL in progress; cleared by the first commit. */
  hyd: boolean;
  /** Hydration: the claimed region snapshot. */
  region: ListNode[] | undefined;
  // ── Mode.
  row: (...args: any[]) => any;
  kf: ((item: any) => any) | undefined;
  bi: boolean;
  ac: boolean;
  ixs: boolean;
  fallback: (() => any) | undefined;
}

const pureOptions = { ownedWrite: true };
const LAZY_OPTIONS = { lazy: true } as const;
const EMPTY: any[] = [];

export const firstOf = (nd: Nodes): ListNode | null =>
  nd === null ? null : Array.isArray(nd) ? nd[0] : nd;
export const lastOf = (nd: Nodes): ListNode | null =>
  nd === null ? null : Array.isArray(nd) ? nd[nd.length - 1] : nd;
export const nodesOf = (r: ListRow): Nodes => (r.n !== null ? r.n : r.ns);

/** First node of the list (skipping zero-node rows), or null when none. */
export function firstNodeOf(slot: ListSlot): ListNode | null {
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
export function lastNodeOf(slot: ListSlot): ListNode | null {
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
export function firstNodeFrom(r: ListRow | null): ListNode | null {
  for (; r !== null; r = r.x) {
    const n = firstOf(nodesOf(r));
    if (n !== null) return n;
  }
  return null;
}

function setNodes(r: ListRow, nd: Nodes): void {
  if (Array.isArray(nd)) {
    r.n = null;
    r.ns = nd;
  } else {
    r.n = nd;
    r.ns = null;
  }
}

// Row build: one shared thunk for the owned row call (no per-row closure);
// arguments and results travel through module slots, consumed synchronously
// before any nested row build can begin.
let bpFn: (...args: any[]) => any;
let bpA0: any;
let bpA1: any;
let bpV: any = null;
let bpF: any = null;
let bpOwner: RowOwner = null as unknown as RowOwner;
const callRow = () => (bpA1 === undefined ? bpFn(bpA0) : bpFn(bpA0, bpA1));

/** Build a row body under its own owner (untracked + owned). Returns the
 * row's nodes (null: zero-node, dynamic, or array output); the owner, raw
 * value and dynamic value come back through `bpOwner` / `bpV` / `bpF`. A
 * throw disposes the row's owner. Arity-exact (mapArray passes one argument
 * to arity-1 mappers). */
function buildParts(
  rowFn: (...args: any[]) => any,
  a0: any,
  a1: any,
  layer: ListNodeLayer | null
): Nodes {
  const o: RowOwner = (bpOwner = createOwner() as unknown as RowOwner);
  bpF = null;
  try {
    bpFn = rowFn;
    bpA0 = a0;
    bpA1 = a1;
    bpV = runWithOwner(o as any, callRow);
    if (layer === null) return null;
    const nd = layer.build(bpV, o);
    bpF = layer.dynamic();
    return nd;
  } catch (e) {
    o.dispose();
    throw e;
  }
}

function buildRow(slot: ListSlot, item: any, j: number, key: any): ListRow {
  const it = slot.ac ? signal(item, pureOptions) : null;
  const ix = slot.ixs ? signal(j, pureOptions) : null;
  const nd = buildParts(
    slot.row,
    it !== null ? accessor(it) : item,
    slot.bi ? j : ix !== null ? accessor(ix) : undefined,
    slot.layer
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
function materialize(slot: ListSlot): void {
  const f = slot.flat!;
  const kf = slot.kf;
  const n = f.items.length;
  let prev: ListRow | null = null;
  for (let i = 0; i < n; i++) {
    const nd = f.nodes[i];
    const r: ListRow = {
      k: kf !== undefined ? kf(f.items[i]) : f.items[i],
      o: f.owners[i],
      it: f.its !== null ? f.its[i] : null,
      ix: f.ixs !== null ? f.ixs[i] : null,
      n: Array.isArray(nd) ? null : nd,
      ns: Array.isArray(nd) ? nd : null,
      f: f.fns !== null ? f.fns[i] : null,
      v: null, // flat mode is rendered-only; array output never materializes
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

/** Mark rows that KEEP their position (LIS of old-middle indices);
 * everything else gets `mv = true`. `oldPos[j]` is -1 for fresh rows. */
function markMoves(order: ListRow[], oldPos: number[]): void {
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

export const IDENTICAL = 0 as const;
export type ListOut = ListPlan | ListFlatPlan | typeof IDENTICAL;

function sameItems(a: ArrayLike<any>, b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface ListEngine {
  slot: ListSlot;
  compute(): ListOut;
  commit(out: ListOut): void;
  /** ARRAY output: the raw row values in order; `[fallback]` when empty with one. */
  values(): any[];
  /** Rendered-output teardown (the engaging insert's cleanup). */
  teardown(): void;
}

/** Create the engine for one list. `layer === null` → array output. */
export function createListEngine(
  meta: ListMeta,
  parent: ListNode | null,
  marker: ListNode | null | undefined,
  layer: ListNodeLayer | null,
  region: ListNode[] | undefined,
  hole: boolean,
  ownerOpts: { id: string } | undefined,
  hyd: boolean
): ListEngine {
  const kf = typeof meta.keyed === "function" ? meta.keyed : undefined;
  const bi = meta.keyed === false;
  const rowFn =
    __DEV__ && meta.name
      ? (...args: any[]) => {
          setStrictRead(meta.name!);
          try {
            return meta.row(...args);
          } finally {
            setStrictRead(false);
          }
        }
      : meta.row;
  const slot: ListSlot = {
    head: null,
    tail: null,
    size: 0,
    parent,
    end: marker ?? null,
    whole: marker === undefined,
    // List owner under the CREATION owner — rows see the context, boundaries
    // and lifetime of the list's source position. Under hydration it takes
    // the parity id.
    owner: runWithOwner(meta.owner, () => createOwner(ownerOpts)) as unknown as RowOwner,
    flat: null,
    pending: null,
    dead: false,
    dyn: false,
    fb: null,
    layer,
    hyd,
    region,
    row: rowFn,
    kf,
    bi,
    ac: bi || kf !== undefined,
    ixs: meta.row.length > 1 && !bi,
    fallback: meta.fallback
  };
  // Flat mode covers every keyed mode of the RENDERED output; `keyed: false`
  // (positional) and array output are chain-first.
  const flatOk = !slot.bi && layer !== null;
  const keyOf = kf !== undefined ? kf : (item: any) => item;

  const dropPending = (): void => {
    const p = slot.pending;
    if (p !== null) {
      if ((p as ListFlatPlan).ff === 1) {
        const { owners } = p as ListFlatPlan;
        for (let j = 0; j < owners.length; j++) owners[j].dispose();
      } else {
        const { order, removes } = p as ListPlan;
        for (let j = 0; j < order.length; j++) if (!order[j].live) order[j].o.dispose();
        for (let j = 0; j < removes.length; j++) removes[j].g = 0;
      }
      if (p.fb !== null && p.fb !== slot.fb) p.fb.o.dispose();
      slot.pending = null;
    }
  };

  const removeFlatDom = (): void => {
    const f = slot.flat!;
    if (layer!.ownsParent(slot)) layer!.clear(slot);
    else for (let i = 0; i < f.nodes.length; i++) layer!.detach(slot, f.nodes[i]);
  };

  /** Resolve the fresh dynamic rows of a plan (tracked). */
  const resolveFreshFlat = (fp: ListFlatPlan): void => {
    const fns = fp.fns!;
    for (let j = 0; j < fns.length; j++)
      if (fns[j] !== null) fp.nodes[j] = layer!.toNodes(layer!.resolve(fns[j]));
  };
  const resolveFreshRows = (order: ListRow[], fb: ListRow | null): void => {
    for (let j = 0; j < order.length; j++) {
      const r = order[j];
      if (!r.live && r.f !== null) setNodes(r, layer!.toNodes(layer!.resolve(r.f)));
    }
    if (fb !== null && !fb.live && fb.f !== null)
      setNodes(fb, layer!.toNodes(layer!.resolve(fb.f)));
  };

  /** The fallback row for an empty list (built owned, like a row). */
  const buildFallback = (): ListRow => {
    const nd = buildParts(slot.fallback!, undefined, undefined, layer);
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

  /** Build the flat arrays for `itemsSnap` (rendered output, keyed modes). */
  const buildFlat = (itemsSnap: any[], mode: "fill" | "replace"): ListFlatPlan => {
    const len = itemsSnap.length;
    const owners: RowOwner[] = new Array(len);
    const nodes: Nodes[] = new Array(len);
    const ixs: any[] | null = slot.ixs ? new Array(len) : null;
    const its: any[] | null = slot.ac ? new Array(len) : null;
    let fns: any[] | null = null;
    const fp: ListFlatPlan = {
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
          const nd = buildParts(slot.row, a0, a1, layer);
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

  /** Chain fill from empty: every row fresh. Removes carry the fallback row. */
  const fillChain = (arr: ArrayLike<any>, removes: ListRow[]): ListPlan => {
    const len = arr.length;
    // Read the items TRACKED before entering the owner wrapper (reads inside
    // runWithOwner are untracked — a store index write must re-run us).
    const snap: any[] = new Array(len);
    for (let j = 0; j < len; j++) snap[j] = arr[j];
    const order: ListRow[] = new Array(len);
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
    const plan: ListPlan = (slot.pending = {
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
   * alive) and collect the changed ones. Rows leaving in the pending plan
   * (g === -1) skip. */
  const scanChain = (): [ListRow, Leaves][] | null => {
    let upd: [ListRow, Leaves][] | null = null;
    for (let r = slot.head; r !== null; r = r.x) {
      if (r.f === null || r.g === -1) continue;
      const leaves = layer!.resolve(r.f);
      if (!layer!.same(leaves, nodesOf(r))) (upd ??= []).push([r, leaves]);
    }
    const fb = slot.fb;
    if (fb !== null && fb.f !== null && fb.g !== -1) {
      const leaves = layer!.resolve(fb.f);
      if (!layer!.same(leaves, nodesOf(fb))) (upd ??= []).push([fb, leaves]);
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
      const leaves = layer!.resolve(fns[j]);
      if (!layer!.same(leaves, f.nodes[j])) (upd ??= []).push([j, leaves]);
    }
    return upd;
  };

  const teardown = (): void => {
    slot.dead = true;
    if (hole && layer !== null) {
      if (slot.flat !== null) removeFlatDom();
      else for (let r = slot.head; r !== null; r = r.x) layer.detach(slot, nodesOf(r));
      if (slot.fb !== null) layer.detach(slot, nodesOf(slot.fb));
    }
    slot.owner.dispose();
  };

  /** All committed chain rows, as a removes list. */
  const allRows = (): ListRow[] => {
    const out: ListRow[] = [];
    for (let r = slot.head; r !== null; r = r.x) {
      r.g = -1;
      out.push(r);
    }
    return out;
  };

  /** Structural half of the compute: items → plan (or IDENTICAL). */
  const structural = (arr: ArrayLike<any>): ListOut => {
    const len = arr.length;
    // A plan parked by a resolution throw whose target still matches: reuse
    // its built rows (no rebuild, no re-invocation) and re-resolve.
    const parked = slot.pending;
    if (parked !== null && parked.target !== undefined && sameItems(arr, parked.target)) {
      if ((parked as ListFlatPlan).ff === 1) resolveFreshFlat(parked as ListFlatPlan);
      else resolveFreshRows((parked as ListPlan).order, parked.fb);
      return parked;
    }
    dropPending();
    // ── FALLBACK: the empty state, when the list has one.
    if (len === 0 && slot.fallback !== undefined) {
      if (slot.fb !== null) return IDENTICAL;
      if (slot.flat !== null) materialize(slot); // leave flat through the chain
      const removes = allRows();
      // Owned like a row: under the list owner (context, boundaries, and the
      // hydration id chain — mapArray renders its fallback there too).
      const fb = runWithOwner(slot.owner as any, buildFallback) as ListRow;
      const plan: ListPlan = (slot.pending = {
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
    // ── FLAT MODE: aligned lists stay flat (zero work); clears and
    // no-survivor replaces stay flat (bulk swap); only a PARTIAL structural
    // op materializes the chain.
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
      // signals). The aligned check above is identity-based on purpose.
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
        // Empty hydrating fill still commits (clears the hydration state).
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
      let r: ListRow | null = slot.head;
      for (let j = 0; j < common; j++, r = r!.x) setSignal(r!.it, arr[j]);
      if (len === size) return IDENTICAL;
      if (len > size) {
        const tail: any[] = new Array(len - size);
        for (let j = size; j < len; j++) tail[j - size] = arr[j]; // tracked reads
        const order: ListRow[] = new Array(len - size);
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
        const plan: ListPlan = (slot.pending = {
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
      const removes: ListRow[] = [];
      for (let q: ListRow | null = r; q !== null; q = q.x) {
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
    let cursor: ListRow | null = slot.head;
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
    // scanning backwards so occurrences pair up in natural order), then old
    // middle rows claim their new positions.
    const width = end - i + 1;
    const midItems: any[] = new Array(width);
    for (let j = 0; j < width; j++) midItems[j] = arr[i + j]; // tracked reads
    const keys: any[] = kf !== undefined ? new Array(width) : midItems;
    const newIndices = new Map<any, number>();
    const newNext: number[] = new Array(width);
    for (let j = width - 1; j >= 0; j--) {
      const key = kf !== undefined ? (keys[j] = kf(midItems[j])) : midItems[j];
      const prev = newIndices.get(key);
      newNext[j] = prev === undefined ? -1 : prev;
      newIndices.set(key, j);
    }
    const order: ListRow[] = new Array(width);
    const oldPos: number[] = new Array(width);
    const removes: ListRow[] = [];
    {
      let r: ListRow | null = cursor;
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
            order[j] = built;
            oldPos[j] = -1;
          }
        }
      });
    } catch (e) {
      // A row fn threw mid-BUILD: fresh rows chain to the PERSISTENT list
      // owner and would leak — dispose before the throw rides the boundary;
      // leaving rows stay committed (un-mark them).
      for (let j = 0; j < width; j++) {
        const r = order[j];
        if (r !== undefined && !r.live) r.o.dispose();
      }
      for (let j = 0; j < removes.length; j++) removes[j].g = 0;
      throw e;
    }
    markMoves(order, oldPos);
    const plan: ListPlan = (slot.pending = {
      order,
      removes,
      before,
      after,
      len,
      upd: null,
      fb: null
    });
    if (anyDyn) {
      slot.dyn = true;
      plan.target = width === len ? midItems : Array.prototype.slice.call(arr);
      resolveFreshRows(order, null);
    }
    return plan;
  };

  const compute = (): ListOut => {
    if (slot.dead) return IDENTICAL;
    // Read FIRST (phase separation): a NotReady here leaves the list
    // untouched and rides the boundary like any compute throw. Array-likes
    // are accepted the way mapArray duck-types them.
    const items = meta.each();
    const arr: ArrayLike<any> = items == null || items === false ? EMPTY : items;
    (arr as any)[$TRACK]; // store arrays: top-level structural tracking
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
    if ((out as ListFlatPlan).ff !== 1) (out as ListPlan).upd = scanChain();
    return out;
  };

  const commit = (out: ListOut): void => {
    if (out === IDENTICAL) return;
    if (out !== slot.pending) return; // superseded mid-flight
    slot.pending = null;
    // The node after the list, read BEFORE removes.
    const endA = layer !== null ? layer.endAnchor(slot) : null;
    // Fallback leaving: detach + dispose before anything is placed.
    const fbOld = slot.fb;
    if (fbOld !== null && out.fb !== fbOld) {
      if (layer !== null) layer.detach(slot, nodesOf(fbOld));
      fbOld.o.dispose();
      slot.fb = null;
    }
    if ((out as ListFlatPlan).ff === 1) {
      const fp = out as ListFlatPlan;
      if (fp.mode === "dyn") {
        const f = slot.flat!;
        const upd = fp.upd!;
        for (let u = upd.length - 1; u >= 0; u--) {
          const j = upd[u][0];
          let anchor: ListNode | null = null;
          for (let q = j + 1; q < f.nodes.length && anchor === null; q++)
            anchor = firstOf(f.nodes[q]);
          if (anchor === null) anchor = endA;
          f.nodes[j] = layer!.splice(slot, f.nodes[j], upd[u][1], anchor);
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
        return;
      }
      if (fp.mode === "replace") {
        removeFlatDom();
        const f = slot.flat!;
        for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
        slot.dyn = fp.fns !== null;
      }
      // Hydrating fill: a claim pass, not a placement pass.
      if (slot.hyd && layer!.commitFill !== null) return layer!.commitFill(slot, fp);
      for (let i = 0; i < fp.nodes.length; i++) layer!.place(slot, fp.nodes[i], endA, true);
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
    const plan = out as ListPlan;
    const { order, removes, before, after } = plan;
    if (layer !== null) {
      // Batch clear: N→0 on an OWNED whole-parent list is one clear + one
      // bulk owner dispose.
      if (
        plan.len === 0 &&
        plan.fb === null &&
        before === null &&
        after === null &&
        layer.ownsParent(slot)
      ) {
        layer.clear(slot);
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
        layer.ownsParent(slot)
      ) {
        layer.clear(slot);
        for (let j = 0; j < removes.length; j++) {
          removes[j].live = false;
          removes[j].o.dispose();
        }
      } else {
        for (let j = 0; j < removes.length; j++) {
          const r = removes[j];
          if (r.live) layer.detach(slot, nodesOf(r));
          r.o.dispose();
        }
      }
      // Place fresh/moved rows back-to-front so anchors are always final.
      // Direct insert per row, deliberately — NOT fragment-batched runs
      // (browsers charge per MOVE; LIS + direct placement is move-minimal).
      let anchor: ListNode | null = after !== null ? firstNodeFrom(after) : null;
      if (anchor === null) anchor = endA;
      const hydrating = slot.hyd;
      for (let j = order.length - 1; j >= 0; j--) {
        const r = order[j];
        const first = firstOf(nodesOf(r));
        if (r.mv) {
          // Hydrating fill (chain modes): rows whose templates CLAIMED server
          // nodes are already in place.
          if (!(hydrating && first !== null && layer.inParent(slot, first)))
            layer.place(slot, nodesOf(r), anchor, !r.live);
          r.live = true;
          r.mv = false;
        }
        if (first !== null) anchor = first;
      }
      slot.hyd = false;
    } else {
      for (let j = 0; j < removes.length; j++) removes[j].o.dispose();
      for (let j = 0; j < order.length; j++) {
        order[j].live = true;
        order[j].mv = false;
      }
    }
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
      if (layer !== null) layer.place(slot, nodesOf(fb), endA, true);
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
        let a: ListNode | null = r === slot.fb ? endA : firstNodeFrom(r.x);
        if (a === null) a = endA;
        setNodes(r, layer!.splice(slot, nodesOf(r), upd[u][1], a));
      }
  };

  const values = (): any[] => {
    if (slot.fb !== null) return [slot.fb.v];
    const out: any[] = new Array(slot.size);
    let i = 0;
    for (let r = slot.head; r !== null; r = r.x) out[i++] = r.v;
    return out;
  };

  return { slot, compute, commit, values, teardown };
}

/** ARRAY output as a memo — `mapArray`'s contract: same array identity while
 * the list is structurally unchanged; `[fallback]` when empty with one.
 * Commits inline (rows are created and disposed in the compute). */
export function listArray(meta: ListMeta): Accessor<any[]> {
  const e = createListEngine(
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
  // Created under the list's CREATION owner — a <For> builds its array output
  // lazily on the first read, and a computed created under the READER would
  // be disposed with that reader's next run.
  const node = runWithOwner(meta.owner, () =>
    computed(
      (): any[] => {
        const out = e.compute();
        if (out === IDENTICAL && last !== undefined) return last;
        e.commit(out);
        return (last = e.values());
      },
      meta.lazy ? LAZY_OPTIONS : undefined
    )
  )!;
  // Untracked reads inside row bodies resolve via the list's own computation
  // (store lookups see pending writes) — mapArray's routing. ARRAY output
  // only: the rendered output READS row-created memos (dynamic rows) from its
  // compute, and routing rows through it would give those memos a height
  // above the compute — a height inversion that double-runs the compute (and
  // rebuilds the pass's fresh rows) whenever a dynamic row flips in the same
  // flush as a list change.
  e.slot.owner._parentComputed = node;
  node._config &= ~CONFIG_AUTO_DISPOSE;
  return accessor(node);
}
