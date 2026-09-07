/**
 * Unified For SLOT (DESIGN-UNIFIED-FOR.md).
 *
 * One persistent structure owns both the row bookkeeping AND the node
 * placement for a keyed <For>: an intrusive doubly-linked chain of rows plus
 * an incrementally-maintained key→row Map, per engaged list. The update is
 * pull-based — an ordinary two-phase render effect reads `each()`, diffs
 * against its own committed chain (prefix walk, suffix walk, middle
 * partition + LIS), and commits placement — no delivery seam, no message
 * channel, no second diff: mapArray and reconcileArrays are both bypassed
 * for engaged lists.
 *
 * DELIVERY (module-graph, no registration): this module rides For's OWN
 * import graph — For stamps `$for.impl` with `unifiedForSlot`, and a
 * renderer's insert() engages it by calling the impl with ITS `SlotOps`
 * singleton (web: `domOps`). Apps without For tree-shake the slot entirely;
 * renderers that ignore `$for` call the accessor and get classic mapArray.
 * The slot itself is platform-free — every node touch rides the ops.
 *
 * PHASE DISCIPLINE (the H1 bet, validated by the spike suites): the COMPUTE
 * half reads, diffs, and may create fresh rows as DETACHED DOM (same
 * legality as template cloning in classic computes), but never touches the
 * live document or the committed chain. The EFFECT half is the only writer
 * of both. Under a held transition the effect doesn't run until reveal, so
 * the slot can never half-apply speculative state; a re-compute before the
 * effect discards the superseded plan's fresh rows and diffs again from
 * committed state.
 *
 * ROW OWNERSHIP (mapArray's own shape, copied): the slot carries ONE owner
 * created under For's CREATION owner (`$for.owner`, the same parent
 * mapArray's internal owner takes) — rows inherit context, boundaries and
 * lifetime from where the <For> was written, not from where its accessor
 * happened to be inserted. The insert's cleanup disposes the slot owner
 * explicitly. Per row: `createOwner()` + `runWithOwner` (untracked + owned —
 * no createRoot closure protocol), and a `nodeType` fast path that skips
 * flatten entirely for the compiled single-root shape. Bulk teardown (clear)
 * is `owner.dispose(false)`.
 *
 * DYNAMIC ROWS (classic's list-effect model, kept): a row whose top level
 * resolves to a FUNCTION — a component returning <Show>/<Dynamic>/a
 * conditional, a memo, a fragment with accessor children — is created once
 * (owned, untracked) and then RESOLVED by the slot's own compute, tracked,
 * every run: exactly the `flatten` read classic's insert effect performs for
 * such rows, moved into the slot. No per-row effect, no marker nodes, no
 * shape demotion — so no double invocation of user row code and no remount
 * cliff. On a flip the commit splices only that row's range.
 *
 * DECLINES (pre-engage) / late-classic DEMOTES (post-engage): `keyed`
 * functions (accessor-row contract), duplicate identity keys, non-array
 * subjects, and hydration shapes the hooks decline. Every decline lands on
 * the classic mapArray path.
 */
import {
  createOwner,
  createRenderEffect,
  flatten,
  onCleanup,
  runWithOwner
} from "@solidjs/signals";
import { IS_DEV } from "./core.js";

/** HYDRATION HOOKS — installed by enableHydration() (for-slot-hydration.ts),
 * null in CSR bundles so every hydration path here folds away (#2883's
 * discipline: pay for hydration only when you hydrate). */
export interface SlotHydration {
  /** Engage-time decision: `false` = not hydrating (normal engage); `null` =
   * decline to classic; `{ id }` = hydrating engage with the parity owner id. */
  engage(
    meta: any,
    marker: SlotNode | null | undefined,
    region: SlotNode[] | undefined
  ): { id: string } | null | false;
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

export interface Row {
  /** Row key — the item reference itself (identity mode only in the spike). */
  k: any;
  /** Row owner (context carrier + disposer). */
  o: RowOwner;
  /** Single-root fast form (the common compiled shape)... */
  n: SlotNode | null;
  /** ...or the fragment form (multi-root rows); exactly one of n/ns is set
   * once resolved (both null only on an unresolved fresh dynamic row). */
  ns: SlotNode[] | null;
  /** DYNAMIC row: the unresolved value (a function, or flatten's resolving
   * wrapper for fragments with accessor leaves) re-read TRACKED by the slot
   * compute every run. null = static row. */
  f: any;
  p: Row | null;
  x: Row | null;
  /** True once the effect phase has placed the row into live DOM. */
  live: boolean;
  /** Needs placement this commit (fresh or displaced) — set by compute,
   * cleared by the commit. Replaces a per-pass Set. */
  mv: boolean;
  /** Reuse stamp for the current pass (duplicate detection without Sets);
   * -1 marks a row leaving in the pending plan. */
  g: number;
}

/** Resolved leaves of a dynamic row this pass (nodes / primitives). */
type Leaves = any[];

interface Plan {
  /** Final row order for the CHANGED middle window only. */
  order: Row[];
  /** Committed rows leaving the list — detach + dispose at commit. */
  removes: Row[];
  /** Chain splice boundaries: last untouched prefix row / first untouched
   * suffix row (null = list edge). */
  before: Row | null;
  after: Row | null;
  /** List length after this plan applies. */
  len: number;
  /** Count of freshly built rows in `order` (dispose-on-supersede set). */
  fresh: number;
  /** Dynamic rows whose resolution changed: splice at commit (chain order). */
  upd: [Row, Leaves][] | null;
  /** Set when a RESOLUTION throw (NotReady) parked this plan: the target
   * items, so the retry can reuse the built rows instead of rebuilding
   * (classic keeps rows in mapArray across an insert-effect NotReady). */
  target?: any[];
}

/** FLAT MODE (lazy structure — the mount-regression fix): first fills carry
 * NO Row objects, no chain, no key map — just parallel arrays (mapArray's
 * own mount economics). The structure MATERIALIZES once, lazily, on the
 * first PARTIAL structural op (the moment the chain/LIS wins start paying);
 * aligned ticks, clears, and no-survivor full replaces stay flat forever. */
export interface Flat {
  /** Committed item snapshot (identity keys). */
  items: any[];
  owners: RowOwner[];
  nodes: (SlotNode | SlotNode[])[];
  /** Dynamic rows' unresolved values by index (null entries = static);
   * null when the list has none. */
  fns: any[] | null;
}

export interface FlatPlan {
  ff: 1;
  mode: "fill" | "replace" | "clear" | "dyn";
  items: any[];
  owners: RowOwner[];
  nodes: (SlotNode | SlotNode[])[];
  fns: any[] | null;
  len: number;
  /** "dyn": changed dynamic rows by index. */
  upd: [number, Leaves][] | null;
  /** See Plan.target. */
  target?: any[];
}

/** RENDERER OPS — the slot's entire platform surface. The slot never touches
 * DOM directly: the engaging insert() hands it ONE module-level singleton
 * (web: `domOps`), so every call site stays monomorphic and V8 inlines the
 * indirection. This is what lets the slot ride For's own module graph
 * (pay-for-use via tree-shaking, no compiler emission, no registration API)
 * and what gives universal renderers a direct adoption path: pass your ops. */
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
  /** True when `first`/`last` are the parent's first/last children (the
   * list IS the parent's whole child list — bulk-clear legality). */
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
  size: number;
  map: Map<any, Row>;
  parent: SlotNode;
  /** Placement anchor: the end marker SlotNode, or null (append at parent end). */
  end: SlotNode | null;
  /** True ONLY for whole-parent inserts (marker === undefined). A `null`
   * marker is classic MULTI mode — trailing child with preceding siblings —
   * and must NEVER take a `textContent = ""` bulk path (P0). */
  whole: boolean;
  owner: RowOwner;
  flat: Flat | null;
  pending: Plan | FlatPlan | null;
  dead: boolean;
  /** True once any dynamic row was built — gates the per-run resolve scan
   * (all-static lists pay nothing). */
  dyn: boolean;
  ops: SlotOps;
  /** HYDRATING FILL in progress (engaged during hydration; cleared by the
   * first commit). While set: row templates CLAIM server nodes and the
   * commit reconciles claimed rows against the region instead of placing.
   * Nothing can demote MID-fill (row shapes never demote; duplicates are
   * only detectable on a later partial op; a non-array subject demotes
   * before any row is built), so claims never need handing back. */
  hyd: boolean;
  /** Hydration: the claimed region snapshot (whole-parent childNodes). */
  region: SlotNode[] | undefined;
}

/** Whole-parent bulk ops (`ops.clear`) are safe only when our window IS the
 * parent's entire child list — classic's ownsAllChildren ruling: streaming
 * appends foreign nodes (late-flushed <link>s) that must survive a clear. */
function ownsParent(slot: Slot): boolean {
  if (!slot.whole) return false;
  const last = lastNode(slot);
  if (last === null) return false;
  const first = slot.flat !== null ? firstOf(slot.flat.nodes[0]) : firstNode(slot.head!);
  return slot.ops.owns(slot.parent, first, last);
}

/** Last committed node of the list (flat or chain), or null when empty. */
function lastNode(slot: Slot): SlotNode | null {
  const f = slot.flat;
  if (f !== null) {
    const n = f.nodes.length;
    return n === 0 ? null : lastOf(f.nodes[n - 1]);
  }
  const t = slot.tail;
  return t === null ? null : lastOf(nodesOf(t));
}

/** The node AFTER the list — classic's contiguity rule (`tail.nextSibling`
 * while the tail is still ours): fresh rows append before it, so a foreign
 * node appended after the list (streamed <link>, user DOM) stays after it.
 * Falls back to the end marker / parent end when the list is empty or its
 * tail migrated away. Read at commit start, BEFORE removes. */
function endAnchor(slot: Slot): SlotNode | null {
  const last = lastNode(slot);
  return last !== null && slot.ops.contains(slot.parent, last) ? slot.ops.next(last) : slot.end;
}

/** Pass generation counter (Row.g stamps). */
let gen = 0;

const nodesOf = (r: Row): SlotNode | SlotNode[] => (r.n !== null ? r.n : r.ns!);
const firstNode = (r: Row): SlotNode => (r.n !== null ? r.n : r.ns![0]);
const firstOf = (nd: SlotNode | SlotNode[]): SlotNode => (Array.isArray(nd) ? nd[0] : nd);
const lastOf = (nd: SlotNode | SlotNode[]): SlotNode =>
  Array.isArray(nd) ? nd[nd.length - 1] : nd;

/** Detach only what is still OURS (classic's `parentNode === parent` guard):
 * a row node the user migrated to another parent is left alone. */
function detach(slot: Slot, n: SlotNode): void {
  if (slot.ops.contains(slot.parent, n)) slot.ops.remove(n);
}
function detachAll(slot: Slot, nd: SlotNode | SlotNode[]): void {
  if (Array.isArray(nd)) for (let i = 0; i < nd.length; i++) detach(slot, nd[i]);
  else detach(slot, nd);
}

/** Insert (fresh) or move (live) a row's nodes before `anchor`. */
function placeRow(slot: Slot, r: Row, anchor: SlotNode | null): void {
  const tag = slot.end;
  const ops = slot.ops;
  if (r.n !== null) {
    ops.insert(slot.parent, r.n, anchor);
    if (tag && !r.live) ops.tag(r.n, tag);
  } else {
    const ns = r.ns!;
    for (let i = 0; i < ns.length; i++) {
      ops.insert(slot.parent, ns[i], anchor);
      if (tag && !r.live) ops.tag(ns[i], tag);
    }
  }
  if (!r.live) {
    r.live = true;
    slot.map.set(r.k, r);
  }
}

function removeRow(slot: Slot, r: Row): void {
  if (r.live) detachAll(slot, nodesOf(r));
  r.o.dispose();
}

const FLATTEN_OPTS = { skipNonRendered: true, doNotUnwrap: true } as const;
const RESOLVE_OPTS = { skipNonRendered: true } as const;
/** Empty-rendering content (null/undefined/false/true/"" or an empty
 * flatten) holds its position with an empty text node — classic's own
 * multi-mode trick; it keeps the row addressable for reorders and the range
 * spliceable for dynamic rows. Normalized here, once. */
const EMPTY: Leaves = [""];
const toLeaves = (v: any): Leaves =>
  v === undefined ? EMPTY : Array.isArray(v) ? (v.length === 0 ? EMPTY : v) : [v];

/** Build a row under its own owner (untracked + owned via runWithOwner —
 * mapArray's per-row shape). Fast path: compiled single-root rows return an
 * element directly and skip flatten. Detached nodes only — placement is the
 * commit's job. Returns [owner, nodes, null] for a STATIC row or
 * [owner, null, f] for a DYNAMIC one (the caller resolves `f` tracked).
 * MUST run inside `runWithOwner(slot.owner, ...)` so the row owner chains to
 * the slot (context + auto-teardown). A throw disposes the row's owner
 * before riding out — it is not yet visible to any caller cleanup. */
function buildParts(
  rowFn: (item: any) => any,
  item: any,
  ops: SlotOps
): [RowOwner, SlotNode | SlotNode[] | null, any] {
  const o: RowOwner = createOwner() as unknown as RowOwner;
  let v: any;
  try {
    v = runWithOwner(o as any, () => rowFn(item));
    if (ops.isNode(v)) return [o, v as SlotNode, null];
    const t = typeof v;
    if (t === "string" || t === "number") return [o, ops.createText(String(v)), null];
    if (t === "function") return [o, null, v]; // dynamic: resolved tracked by the caller
    // Fragments / nested arrays: flatten owned, leaving accessor leaves
    // unresolved — a resolving wrapper comes back when there are any, and
    // the row is dynamic; otherwise the leaves are static.
    v = runWithOwner(o as any, () => flatten(v, FLATTEN_OPTS));
  } catch (e) {
    o.dispose();
    throw e;
  }
  if (typeof v === "function") return [o, null, v];
  return [o, leavesToNodes(toLeaves(v), ops), null];
}

/** Resolve a dynamic row's value — the tracked `flatten` read classic's
 * insert effect performs. Normalized to a (non-empty) leaves array. */
function resolve(f: any): Leaves {
  return toLeaves(flatten(f, RESOLVE_OPTS));
}

/** Materialize leaves as DETACHED nodes (fresh rows). */
function leavesToNodes(leaves: Leaves, ops: SlotOps): SlotNode | SlotNode[] {
  const n = leaves.length;
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
function sameLeaves(leaves: Leaves, cur: SlotNode | SlotNode[], ops: SlotOps): boolean {
  const arr = Array.isArray(cur) ? cur : null;
  const n = leaves.length;
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

function setNodes(r: Row, nd: SlotNode | SlotNode[]): void {
  if (Array.isArray(nd)) {
    r.n = null;
    r.ns = nd;
  } else {
    r.n = nd;
    r.ns = null;
  }
}

/** Commit-side splice of a dynamic row's range: reuse positional text nodes
 * with a `.data` write (classic's primitive adoption), detach what didn't
 * survive (guarded), and place the new range before `anchor`. */
function spliceRange(
  slot: Slot,
  cur: SlotNode | SlotNode[],
  leaves: Leaves,
  anchor: SlotNode | null
): SlotNode | SlotNode[] {
  const ops = slot.ops;
  const arr = Array.isArray(cur) ? cur : [cur];
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
    ops.insert(slot.parent, out[i], anchor);
    if (tag) ops.tag(out[i], tag);
    anchor = out[i];
  }
  return n === 1 ? out[0] : out;
}

function buildRow(rowFn: (item: any) => any, item: any, ops: SlotOps): Row {
  const parts = buildParts(rowFn, item, ops);
  const nd = parts[1];
  return Array.isArray(nd)
    ? {
        k: item,
        o: parts[0],
        n: null,
        ns: nd,
        f: parts[2],
        p: null,
        x: null,
        live: false,
        mv: true,
        g: 0
      }
    : {
        k: item,
        o: parts[0],
        n: nd,
        ns: null,
        f: parts[2],
        p: null,
        x: null,
        live: false,
        mv: true,
        g: 0
      };
}

/** Lossless representation change: committed flat arrays → chain + map.
 * Runs in COMPUTE (phase-safe: it derives bookkeeping from COMMITTED state,
 * touches no DOM, and stays valid if the pass aborts). Returns false on
 * duplicate identity keys (classic owns duplicates → demote). */
function materialize(slot: Slot): boolean {
  const f = slot.flat!;
  const n = f.items.length;
  let prev: Row | null = null;
  for (let i = 0; i < n; i++) {
    const nd = f.nodes[i];
    const fn = f.fns !== null ? f.fns[i] : null;
    const r: Row = Array.isArray(nd)
      ? {
          k: f.items[i],
          o: f.owners[i],
          n: null,
          ns: nd,
          f: fn,
          p: prev,
          x: null,
          live: true,
          mv: false,
          g: 0
        }
      : {
          k: f.items[i],
          o: f.owners[i],
          n: nd,
          ns: null,
          f: fn,
          p: prev,
          x: null,
          live: true,
          mv: false,
          g: 0
        };
    if (slot.map.has(r.k)) {
      // Roll back the partial chain bookkeeping; demote handles teardown.
      slot.map.clear();
      slot.head = slot.tail = null;
      return false;
    }
    slot.map.set(r.k, r);
    if (prev !== null) prev.x = r;
    else slot.head = r;
    prev = r;
  }
  slot.tail = prev;
  slot.size = n;
  slot.flat = null;
  return true;
}

// LIS scratch (module-level, reused — stablePositions runs NO user code, so
// reentrancy is impossible mid-call).
let lisTails: number[] = [];
let lisTailIdx: number[] = [];
let lisPrev: number[] = [];

/** Mark rows that KEEP their DOM position (longest increasing subsequence of
 * old-middle indices); everything else gets `mv = true`. `oldPos[j]` is -1
 * for fresh rows (already stamped mv by buildRow). */
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
  // Everything moves unless proven stable.
  for (let i = 0; i < len; i++) if (oldPos[i] !== -1) order[i].mv = true;
  let at = tlen > 0 ? lisTailIdx[tlen - 1] : -1;
  while (at !== -1) {
    order[at].mv = false;
    at = lisPrev[at];
  }
}

const IDENTICAL = 0 as const;
const DEMOTE = 1 as const;
type ComputeOut = Plan | FlatPlan | typeof IDENTICAL | typeof DEMOTE;

function sameItems(a: readonly any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** THE unified For slot — For stamps this as `$for.impl`; a renderer's
 * insert() engages it with its SlotOps. Returns false to decline (classic
 * path); lateClassic re-enters classic insert after a post-engage demote. */
export function unifiedForSlot(
  parent: SlotNode,
  listFn: any,
  marker: SlotNode | null | undefined,
  lateClassic: () => void,
  ops: SlotOps,
  region?: SlotNode[],
  /** HOLE mode: engaged from inside a wrapper insert's compute (the
   * `{props.children}` seam). The hosting effect owns the hole, so this
   * slot removes its rows on cleanup (a children change or dispose) — in
   * direct mode the parent element's removal covers that for free. */
  hole = false
): boolean {
  const meta = listFn.$for;
  // H4 pin: keyed-fn rows receive accessors in the classic contract — the
  // slot binds raw items, so engaging would hand user code the wrong shape.
  if (typeof meta.keyed === "function") return false;
  // HYDRATION (H2): decided by the installed hooks (null in CSR bundles —
  // the branch folds away). A hydrating engage hands back the parity owner
  // id so the slot's rows mint the same hydration keys classic's would.
  let ownerOpts: { id: string } | undefined;
  let hyd = false;
  if (slotHydration !== null) {
    const h = slotHydration.engage(meta, marker, region);
    if (h === null) return false;
    if (h !== false) {
      ownerOpts = h;
      hyd = true;
    }
  }

  const slot: Slot = {
    head: null,
    tail: null,
    size: 0,
    map: new Map(),
    parent,
    end: marker ?? null,
    whole: marker === undefined,
    // Slot owner under For's CREATION owner — where mapArray's internal
    // owner lives in classic — so rows see the context, boundaries and
    // lifetime of the <For>'s source position, not the insertion point's.
    // Under hydration it takes the explicit parity id.
    owner: runWithOwner(meta.owner, () => createOwner(ownerOpts)) as unknown as RowOwner,
    flat: null,
    pending: null,
    dead: false,
    dyn: false,
    ops,
    hyd,
    region
  };
  if (IS_DEV) __unifiedForStats.engaged++;

  const dropPending = (): void => {
    if (slot.pending !== null) {
      if ((slot.pending as FlatPlan).ff === 1) {
        // A superseded flat plan placed nothing — dispose all its owners
        // (a "dyn" plan owns no rows of its own).
        const { owners } = slot.pending as FlatPlan;
        for (let j = 0; j < owners.length; j++) owners[j].dispose();
      } else {
        const { order, removes } = slot.pending as Plan;
        for (let j = 0; j < order.length; j++) if (!order[j].live) order[j].o.dispose();
        // The plan's leaving rows stay committed — clear their -1 marks so
        // the dynamic scan sees them again.
        for (let j = 0; j < removes.length; j++) removes[j].g = 0;
      }
      slot.pending = null;
    }
  };

  const removeFlatDom = (): void => {
    const f = slot.flat!;
    if (ownsParent(slot)) ops.clear(slot.parent);
    else for (let i = 0; i < f.nodes.length; i++) detachAll(slot, f.nodes[i]);
  };

  const demote = (): void => {
    // Late-classic (contract carried from the patch-driver era): tear the
    // slot down whole, then re-enter classic insert under the ORIGINAL owner.
    if (IS_DEV) __unifiedForStats.demoted++;
    slot.dead = true;
    dropPending();
    if (slot.flat !== null) {
      removeFlatDom();
      slot.flat = null;
    }
    for (let r = slot.head; r !== null; r = r.x) detachAll(slot, nodesOf(r));
    slot.owner.dispose(); // bulk: every row owner is a child
    slot.head = slot.tail = null;
    slot.size = 0;
    slot.map.clear();
    lateClassic();
  };

  /** Resolve the fresh dynamic rows of a plan (tracked). A throw here parks
   * the plan with its target so the retry reuses the built rows. */
  const resolveFreshFlat = (fp: FlatPlan): void => {
    const fns = fp.fns!;
    for (let j = 0; j < fns.length; j++)
      if (fns[j] !== null) fp.nodes[j] = leavesToNodes(resolve(fns[j]), ops);
  };
  const resolveFreshRows = (order: Row[]): void => {
    for (let j = 0; j < order.length; j++) {
      const r = order[j];
      if (!r.live && r.f !== null) setNodes(r, leavesToNodes(resolve(r.f), ops));
    }
  };

  /** Build the flat arrays for `itemsSnap` (tracked snapshot already taken
   * by the caller). */
  const buildFlat = (itemsSnap: any[], mode: "fill" | "replace"): FlatPlan => {
    const len = itemsSnap.length;
    const owners: RowOwner[] = new Array(len);
    const nodes: (SlotNode | SlotNode[])[] = new Array(len);
    let fns: any[] | null = null;
    const fp: FlatPlan = { ff: 1, mode, items: itemsSnap, owners, nodes, fns, len, upd: null };
    const build = (): void => {
      runWithOwner(slot.owner as any, () => {
        for (let j = 0; j < len; j++) {
          const parts = buildParts(meta.row, itemsSnap[j], ops);
          owners[j] = parts[0];
          if (parts[2] !== null) {
            if (fns === null) fns = new Array(len).fill(null);
            fns[j] = parts[2];
          } else nodes[j] = parts[1]!;
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
    };
    try {
      build();
    } catch (e) {
      // A row fn threw mid-BUILD (untracked, mapArray parity): rows built so
      // far chain to the PERSISTENT slot owner and would leak until slot
      // death — dispose, then let the throw ride the boundary. A throw from
      // RESOLUTION (fp is parked) keeps the rows for the retry instead.
      if (slot.pending !== fp) for (let d = 0; d < len; d++) owners[d]?.dispose();
      throw e;
    }
    return fp;
  };

  /** Re-read every committed dynamic row (tracked — this is what keeps the
   * slot subscribed, exactly like classic's per-run flatten) and collect the
   * ones whose resolution changed. Rows leaving in `plan` (g === -1) skip. */
  const scanChain = (): [Row, Leaves][] | null => {
    let upd: [Row, Leaves][] | null = null;
    for (let r = slot.head; r !== null; r = r.x) {
      if (r.f === null || r.g === -1) continue;
      const leaves = resolve(r.f);
      if (!sameLeaves(leaves, nodesOf(r), ops)) (upd ??= []).push([r, leaves]);
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
      if (!sameLeaves(leaves, f.nodes[j], ops)) (upd ??= []).push([j, leaves]);
    }
    return upd;
  };

  // The insert owner disposes the slot's render effect; the slot owner lives
  // under For's creation owner, so dispose it explicitly here. HOLE mode
  // also removes the rows: the hosting effect keeps the parent and re-fills it.
  onCleanup(() => {
    slot.dead = true;
    if (hole) {
      if (slot.flat !== null) removeFlatDom();
      else for (let r = slot.head; r !== null; r = r.x) detachAll(slot, nodesOf(r));
    }
    slot.owner.dispose();
  });

  /** Structural half of the compute: items → plan (or IDENTICAL / DEMOTE). */
  const structural = (arr: readonly any[]): ComputeOut => {
    const len = arr.length;
    // A plan parked by a resolution throw whose target still matches: reuse
    // its built rows (no rebuild, no re-invocation) and re-resolve.
    const parked = slot.pending;
    if (parked !== null && parked.target !== undefined && sameItems(arr, parked.target)) {
      if ((parked as FlatPlan).ff === 1) resolveFreshFlat(parked as FlatPlan);
      else resolveFreshRows((parked as Plan).order);
      return parked;
    }
    // A superseded plan's fresh rows were never placed — discard, then
    // diff again from COMMITTED state (retry against uncorrupted state).
    dropPending();
    // ── FLAT MODE (lazy structure): aligned lists stay flat (zero work);
    // clears and no-survivor replaces stay flat (bulk swap); only a
    // PARTIAL structural op materializes the chain — once, amortized into
    // the op the chain's wins then repay.
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
          len: 0,
          upd: null
        });
      // Survivor probe (once, on the rare structural event): no shared
      // identities = full replace — swap flat wholesale, never build rows.
      let survivor = false;
      {
        const old = new Set(fi);
        for (let j = 0; j < len; j++)
          if (old.has(arr[j])) {
            survivor = true;
            break;
          }
      }
      if (!survivor) {
        const snap: any[] = new Array(len);
        for (let j = 0; j < len; j++) snap[j] = arr[j];
        return (slot.pending = buildFlat(snap, "replace"));
      }
      // Partial structure: materialize the chain from committed flat state
      // (phase-safe: pure bookkeeping over committed rows, no DOM) and
      // fall through to the structural walk.
      if (!materialize(slot)) return DEMOTE; // duplicate identity keys
    }
    // ── FLAT FILL: an empty slot fills with arrays only (mapArray's mount
    // economics — no Rows, no chain, no map).
    if (slot.head === null && slot.size === 0) {
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
          len: 0,
          upd: null
        });
      }
      const snap: any[] = new Array(len);
      for (let j = 0; j < len; j++) snap[j] = arr[j];
      return (slot.pending = buildFlat(snap, "fill"));
    }
    // ── Prefix walk.
    let cursor = slot.head;
    let i = 0;
    while (cursor !== null && i < len && cursor.k === arr[i]) {
      cursor = cursor.x;
      i++;
    }
    if (i === len && cursor === null) return IDENTICAL;
    const before = cursor === null ? slot.tail : cursor.p; // last prefix row
    // ── Suffix walk.
    let tailCursor = slot.tail;
    let end = len - 1;
    let oldRemain = slot.size - i;
    while (tailCursor !== null && oldRemain > 0 && end >= i && tailCursor.k === arr[end]) {
      tailCursor = tailCursor.p;
      end--;
      oldRemain--;
    }
    const after = oldRemain === 0 ? cursor : tailCursor!.x; // first suffix row
    const passGen = ++gen;
    // ── Old middle rows, keyed for reuse (map probe stamps duplicates).
    const oldMid: Row[] = new Array(oldRemain);
    {
      let r = cursor;
      for (let c = 0; c < oldRemain; c++) {
        oldMid[c] = r!;
        r = r!.x;
      }
    }
    const oldIndexOf = new Map<any, number>();
    for (let j = 0; j < oldRemain; j++) {
      if (oldIndexOf.has(oldMid[j].k)) return DEMOTE; // duplicate keys
      oldIndexOf.set(oldMid[j].k, j);
    }
    // ── New middle: reuse by key; build the rest (detached, owned by the
    // slot owner — untracked via runWithOwner inside buildRow).
    const width = end - i + 1;
    // Read the window TRACKED, before entering the owner wrapper: inside
    // runWithOwner reads are untracked, and an untracked store read
    // resolves the COMMITTED backing while this flush's setter writes are
    // still pending — `length` (a written node) says N+1 while the unread
    // index N falls back to committed undefined. mapArray solves the same
    // tear with `_owner._parentComputed` routing; the driver hoists the
    // reads instead.
    const midItems: any[] = new Array(width);
    for (let j = 0; j < width; j++) midItems[j] = arr[i + j];
    const order: Row[] = new Array(width);
    const oldPos: number[] = new Array(width);
    let fresh = 0;
    let demoteFlag = false;
    let anyDyn = false;
    try {
      runWithOwner(slot.owner as any, () => {
        for (let j = 0; j < width; j++) {
          const item = midItems[j];
          const at = oldIndexOf.get(item);
          if (at !== undefined) {
            if (at === -1) {
              demoteFlag = true; // duplicate among FRESH keys this pass
              return;
            }
            const row = oldMid[at];
            if (row.g === passGen) {
              demoteFlag = true; // duplicate incoming key
              return;
            }
            row.g = passGen;
            order[j] = row;
            oldPos[j] = at;
          } else if (slot.map.has(item)) {
            // Same identity alive outside the middle window = duplicate key
            // across the prefix/suffix boundary. Classic owns duplicates.
            demoteFlag = true;
            return;
          } else {
            const built = buildRow(meta.row, item, ops);
            if (built.f !== null) anyDyn = true;
            fresh++;
            order[j] = built;
            oldPos[j] = -1;
            // Fresh keys join the probe map (-1) so a second fresh copy of
            // the same identity is caught as a duplicate, not committed
            // twice against a key→row map that can hold only one.
            oldIndexOf.set(item, -1);
          }
        }
      });
    } catch (e) {
      // A row fn threw mid-BUILD: fresh rows chain to the PERSISTENT slot
      // owner and would leak until slot death — dispose before the throw
      // rides the boundary. (Reused rows stay live; their g-stamps are
      // reset by the next pass's fresh passGen.)
      for (let j = 0; j < width; j++) {
        const r = order[j];
        if (r !== undefined && !r.live) r.o.dispose();
      }
      throw e;
    }
    if (demoteFlag) {
      // Partial build: dispose what this pass created before demoting.
      for (let j = 0; j < width; j++) {
        const r = order[j];
        if (r !== undefined && !r.live) r.o.dispose();
      }
      return DEMOTE;
    }
    markMoves(order, oldPos);
    const removes: Row[] = [];
    for (let j = 0; j < oldRemain; j++)
      if (oldMid[j].g !== passGen) {
        oldMid[j].g = -1; // leaving: the dynamic scan skips it
        removes.push(oldMid[j]);
      }
    const plan: Plan = (slot.pending = { order, removes, before, after, len, fresh, upd: null });
    if (anyDyn) {
      // Fresh dynamic rows: initial resolution, TRACKED. Park first so a
      // NotReady keeps the built rows for the retry.
      slot.dyn = true;
      plan.target = midItems.length === len ? midItems : Array.prototype.slice.call(arr);
      resolveFreshRows(order);
    }
    return plan;
  };

  effect(
    (): ComputeOut => {
      if (slot.dead) return IDENTICAL;
      // Read FIRST (phase separation, design H5): a NotReady here leaves the
      // slot untouched and rides the boundary like any compute throw.
      const items = meta.each();
      if (items != null && items !== false && !Array.isArray(items)) return DEMOTE;
      const arr: readonly any[] = items == null || items === false ? [] : items;
      const out = structural(arr);
      if (out === DEMOTE || !slot.dyn) return out;
      // ── Dynamic rows: re-read every committed one (keeps the subscription
      // alive — classic's per-run flatten) and attach the changed ranges.
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
            len: f.items.length,
            upd
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
          fresh: 0,
          upd
        });
      }
      if ((out as FlatPlan).ff !== 1) (out as Plan).upd = scanChain();
      return out;
    },
    out => {
      if (out === IDENTICAL) return;
      if (out === DEMOTE) return demote();
      if ((out as FlatPlan).ff === 1) {
        const fp = out as FlatPlan;
        if (fp !== slot.pending) return; // superseded mid-flight
        slot.pending = null;
        const endA = endAnchor(slot);
        if (fp.mode === "dyn") {
          const f = slot.flat!;
          const upd = fp.upd!;
          for (let u = upd.length - 1; u >= 0; u--) {
            const j = upd[u][0];
            const anchor = j + 1 < f.nodes.length ? firstOf(f.nodes[j + 1]) : endA;
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
        // Hydrating fill: a claim pass, not a placement pass — the hooks
        // reconcile claimed rows against the region (mismatch only).
        if (slot.hyd) return slotHydration!.commitFill(slot, fp);
        // fill / replace: append the new window before the list end.
        const tag = slot.end;
        for (let i = 0; i < fp.nodes.length; i++) {
          const nd = fp.nodes[i];
          if (Array.isArray(nd))
            for (const n of nd) {
              ops.insert(slot.parent, n, endA);
              if (tag) ops.tag(n, tag);
            }
          else {
            ops.insert(slot.parent, nd, endA);
            if (tag) ops.tag(nd, tag);
          }
        }
        slot.flat = { items: fp.items, owners: fp.owners, nodes: fp.nodes, fns: fp.fns };
        slot.size = fp.len;
        return;
      }
      const plan = out as Plan;
      if (plan !== slot.pending) return; // superseded mid-flight
      slot.pending = null;
      const { order, removes, before, after } = plan;
      // The node after the list, read BEFORE removes (a leaving tail's
      // nextSibling is still the list end).
      const endA = endAnchor(slot);
      // Batch clear (design §5.2): N→0 on an OWNED whole-parent slot is one
      // `textContent = ''` + one bulk owner dispose — no per-row work.
      // ownsParent guards both the null-marker MULTI case (preceding
      // siblings, P0) and foreign nodes streaming appended to our parent.
      if (plan.len === 0 && before === null && after === null && ownsParent(slot)) {
        if (IS_DEV) __unifiedForStats.batchCleared++;
        ops.clear(slot.parent);
        slot.owner.dispose(false);
        slot.map.clear();
        slot.head = slot.tail = null;
        slot.size = 0;
        slot.dyn = false;
        return;
      }
      // Full replace (no survivors, owned whole parent): bulk-detach the old
      // rows with one textContent write, dispose them without per-node
      // removes, and let the placement walk below append the fresh window.
      // Covers the jfb `replace` / `runlots`-over-rows shapes.
      if (
        before === null &&
        after === null &&
        removes.length === slot.size &&
        removes.length > 0 &&
        ownsParent(slot)
      ) {
        ops.clear(slot.parent);
        for (let j = 0; j < removes.length; j++) {
          removes[j].live = false;
          removes[j].o.dispose();
        }
        slot.map.clear();
      } else {
        // 1. Removes: detach + dispose + unmap.
        for (let j = 0; j < removes.length; j++) {
          removeRow(slot, removes[j]);
          slot.map.delete(removes[j].k);
        }
      }
      // 2. Place fresh/moved rows back-to-front so anchors are always final.
      // Direct insertBefore per row, deliberately — NOT fragment-batched runs.
      // Browsers charge per MOVE, and LIS + direct placement is move-minimal
      // (Chrome: shuffle 0.63 vs classic ~0.75-0.80). Batching moved rows
      // through a DocumentFragment moves each live row TWICE (into the
      // fragment, then into the parent): it made jsdom ~10% faster (its cost
      // is anchor-index computation, not moves) and Chrome 20-25% slower on
      // reverse/shuffle — measured both orders, 2026-09-06. The jsdom-based
      // CodSpeed shuffle bench therefore reads ~10% behind classic by
      // construction; that is the accepted trade. Ruling: prioritize browsers.
      let anchor: SlotNode | null = after !== null ? firstNode(after) : endA;
      for (let j = order.length - 1; j >= 0; j--) {
        const r = order[j];
        if (r.mv) {
          placeRow(slot, r, anchor);
          r.mv = false;
        }
        anchor = firstNode(r);
      }
      // 3. Splice the chain: [before] → order… → [after].
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
      // 4. Dynamic rows whose resolution changed: splice each range, back to
      // front so a row's anchor (its successor's first node) is final.
      const upd = plan.upd;
      if (upd !== null)
        for (let u = upd.length - 1; u >= 0; u--) {
          const r = upd[u][0];
          const a = r.x !== null ? firstNode(r.x) : endA;
          setNodes(r, spliceRange(slot, nodesOf(r), upd[u][1], a));
        }
    }
  );
  return true;
}

/** DEV-ONLY probes: engagement / demotion / batch-clear counters, exposed as
 * `DEV.unifiedFor` (solid-js's dev diagnostics bag — undefined in prod).
 * Increments are IS_DEV-gated; not a package export of its own. */
export interface UnifiedForStats {
  engaged: number;
  demoted: number;
  batchCleared: number;
}
export const __unifiedForStats: UnifiedForStats = { engaged: 0, demoted: 0, batchCleared: 0 };
