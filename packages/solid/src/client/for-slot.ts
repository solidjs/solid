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
 * ROW OWNERSHIP (mapArray's own diet, copied): the slot carries ONE owner
 * created at engage time under the insert context — rows inherit context
 * through it, survive compute reruns because they never chain to the
 * per-run scope, and the whole slot tears down automatically with the
 * component (no manual cleanup walk). Per row: `createOwner()` +
 * `runWithOwner` (untracked + owned — no createRoot closure protocol), and
 * a `nodeType` fast path that skips flatten entirely for the compiled
 * single-root shape. Bulk teardown (clear) is `owner.dispose(false)`.
 *
 * SPIKE SCOPE — declines (pre-engage) or late-classic demotes (post-engage)
 * rather than implements: hydration claiming (H2), `keyed` functions
 * (accessor-row contract, H4), duplicate keys, rows whose top level is a
 * FUNCTION (dynamic top-level content), empty-rendering rows, and non-array
 * subjects. Every decline lands on the classic mapArray path.
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
    marker: Node | null | undefined,
    region: Node[] | undefined
  ): { id: string } | null | false;
  /** Run a build pass recording the registry keys its templates consume. */
  record<T>(slot: Slot, fn: () => T): T;
  /** Demote mid-fill: hand recorded claims back for classic's re-run. */
  restore(slot: Slot): void;
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

export interface Row {
  /** Row key — the item reference itself (identity mode only in the spike). */
  k: any;
  /** Row owner (context carrier + disposer). */
  o: RowOwner;
  /** Single-root fast form (the common compiled shape)... */
  n: Node | null;
  /** ...or the fragment form (multi-root rows); exactly one of n/ns is set. */
  ns: Node[] | null;
  p: Row | null;
  x: Row | null;
  /** True once the effect phase has placed the row into live DOM. */
  live: boolean;
  /** Needs placement this commit (fresh or displaced) — set by compute,
   * cleared by the commit. Replaces a per-pass Set. */
  mv: boolean;
  /** Reuse stamp for the current pass (duplicate detection without Sets). */
  g: number;
}

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
  nodes: (Node | Node[])[];
}

export interface FlatPlan {
  ff: 1;
  mode: "fill" | "replace" | "clear";
  items: any[];
  owners: RowOwner[];
  nodes: (Node | Node[])[];
  len: number;
}

/** RENDERER OPS — the slot's entire platform surface. The slot never touches
 * DOM directly: the engaging insert() hands it ONE module-level singleton
 * (web: `domOps` below), so every call site stays monomorphic and V8 inlines
 * the indirection. This is what lets the slot ride For's own module graph
 * (pay-for-use via tree-shaking, no compiler emission, no registration API)
 * and what gives universal renderers a direct adoption path: pass your ops. */
export interface SlotOps {
  insert(parent: Node, node: Node, anchor: Node | null): void;
  remove(node: Node): void;
  createText(text: string): Node;
  isNode(v: unknown): boolean;
  /** Whole-parent bulk clear (batch-clear / full-replace fast paths). */
  clear(parent: Node): void;
  /** Ownership marker for multi-slot parents (web: `$$SLOT`). */
  tag(node: Node, marker: Node): void;
  /** True when `node` is a direct child of `parent` (hydration fix-up). */
  contains(parent: Node, node: Node): boolean;
}

export interface Slot {
  head: Row | null;
  tail: Row | null;
  size: number;
  map: Map<any, Row>;
  parent: Node;
  /** Placement anchor: the end marker Node, or null (append at parent end). */
  end: Node | null;
  /** True ONLY for whole-parent inserts (marker === undefined). A `null`
   * marker is classic MULTI mode — trailing child with preceding siblings —
   * and must NEVER take a `textContent = ""` bulk path (P0). */
  whole: boolean;
  owner: RowOwner;
  flat: Flat | null;
  pending: Plan | FlatPlan | null;
  dead: boolean;
  ops: SlotOps;
  /** HYDRATING FILL in progress (engaged during hydration; cleared by the
   * first commit). While set: row templates CLAIM server nodes, registry
   * deletions are recorded so a demote can hand them back, and the commit
   * reconciles claimed rows against the region instead of placing. */
  hyd: boolean;
  /** Registry entries consumed during the hydrating fill (key, node). */
  hydLog: [string, Element][] | null;
  /** Hydration: the claimed region snapshot (whole-parent childNodes). */
  region: Node[] | undefined;
}

/** Whole-parent bulk ops (`ops.clear`) are safe only when our window IS the
 * parent's entire child list — classic's ownsAllChildren ruling: streaming
 * appends foreign nodes (late-flushed <link>s) that must survive a clear. */
function ownsParent(slot: Slot): boolean {
  if (!slot.whole) return false;
  let first: Node | null = null;
  let last: Node | null = null;
  const f = slot.flat;
  if (f !== null) {
    const n = f.nodes.length;
    if (n === 0) return false;
    const n0 = f.nodes[0];
    first = Array.isArray(n0) ? n0[0] : n0;
    const nl = f.nodes[n - 1];
    last = Array.isArray(nl) ? nl[nl.length - 1] : nl;
  } else if (slot.head !== null) {
    first = firstNode(slot.head);
    const t = slot.tail!;
    last = t.n !== null ? t.n : t.ns![t.ns!.length - 1];
  } else return false;
  return slot.parent.firstChild === first && slot.parent.lastChild === last;
}

/** Pass generation counter (Row.g stamps). */
let gen = 0;

const firstNode = (r: Row): Node => (r.n !== null ? r.n : r.ns![0]);

/** Insert (fresh) or move (live) a row's nodes before `anchor`. */
function placeRow(slot: Slot, r: Row, anchor: Node | null): void {
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

function removeRow(r: Row, ops: SlotOps): void {
  if (r.live) {
    if (r.n !== null) ops.remove(r.n);
    else for (const n of r.ns!) ops.remove(n);
  }
  r.o.dispose();
}

const FLATTEN_OPTS = { skipNonRendered: true, doNotUnwrap: true } as const;

/** Build a row under its own owner (untracked + owned via runWithOwner —
 * mapArray's per-row shape). Fast path: compiled single-root rows return an
 * element directly and skip flatten. Detached nodes only — placement is the
 * commit's job. Returns null when the row shape is outside the slot
 * contract. MUST run inside `runWithOwner(slot.owner, ...)` so the row
 * owner chains to the slot (context + auto-teardown). */
/** Row-body build core: owner + detached nodes, no bookkeeping. Returns
 * [owner, node|nodes] or null (shape outside contract). Shared by the flat
 * fill (arrays only) and structural buildRow (wraps into a Row). */
function buildParts(
  rowFn: (item: any) => any,
  item: any,
  ops: SlotOps
): [RowOwner, Node | Node[]] | null {
  const o: RowOwner = createOwner() as unknown as RowOwner;
  let v = runWithOwner(o as any, () => rowFn(item));
  if (ops.isNode(v)) return [o, v as Node];
  const t = typeof v;
  if (t === "string" || t === "number") return [o, ops.createText(String(v))];
  // Slow path: fragments / nested arrays / signals — flatten (still owned).
  v = runWithOwner(o as any, () => flatten(v, FLATTEN_OPTS));
  if (Array.isArray(v) && v.length > 0) {
    const ns: Node[] = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if (typeof c === "function") return (o.dispose(), null);
      ns[i] = ops.isNode(c) ? (c as Node) : ops.createText(String(c));
    }
    return [o, ns];
  }
  if (ops.isNode(v)) return [o, v as Node];
  // Empty-rendering rows (null/undefined/false/true/"" or an empty flatten)
  // hold their position with an empty text node — classic's own multi-mode
  // trick. Demoting here would tear down SIBLING rows' DOM state (focused
  // inputs, scroll) to rebuild through classic; a placeholder is strictly
  // better and keeps the row addressable for reorders.
  if (v == null || typeof v === "boolean" || v === "" || (Array.isArray(v) && v.length === 0))
    return [o, ops.createText("")];
  o.dispose();
  return null; // function top level (dynamic content) / unrenderable → classic
}

function buildRow(rowFn: (item: any) => any, item: any, ops: SlotOps): Row | null {
  const parts = buildParts(rowFn, item, ops);
  if (parts === null) return null;
  const nd = parts[1];
  return Array.isArray(nd)
    ? { k: item, o: parts[0], n: null, ns: nd, p: null, x: null, live: false, mv: true, g: 0 }
    : { k: item, o: parts[0], n: nd, ns: null, p: null, x: null, live: false, mv: true, g: 0 };
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
    const r: Row = Array.isArray(nd)
      ? {
          k: f.items[i],
          o: f.owners[i],
          n: null,
          ns: nd,
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

/** THE unified For slot — For stamps this as `$for.impl`; a renderer's
 * insert() engages it with its SlotOps. Returns false to decline (classic
 * path); lateClassic re-enters classic insert after a post-engage demote. */
export function unifiedForSlot(
  parent: Node,
  listFn: any,
  marker: Node | null | undefined,
  lateClassic: () => void,
  ops: SlotOps,
  region?: Node[]
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
    // Slot owner under the INSERT context: rows inherit context through it,
    // survive compute reruns, and tear down automatically with the
    // component — cleanup needs no row walk. Under hydration it takes the
    // explicit parity id (no consumption of the insert owner's counter).
    owner: createOwner(ownerOpts) as unknown as RowOwner,
    flat: null,
    pending: null,
    dead: false,
    ops,
    hyd,
    hydLog: null,
    region
  };
  if (IS_DEV) __unifiedForStats.engaged++;

  const dropPending = (): void => {
    if (slot.pending !== null) {
      if ((slot.pending as FlatPlan).ff === 1) {
        // A superseded flat plan placed nothing — dispose all its owners.
        const { owners } = slot.pending as FlatPlan;
        for (let j = 0; j < owners.length; j++) owners[j].dispose();
      } else {
        const { order } = slot.pending as Plan;
        for (let j = 0; j < order.length; j++) if (!order[j].live) order[j].o.dispose();
      }
      slot.pending = null;
    }
  };

  const removeFlatDom = (): void => {
    const f = slot.flat!;
    if (ownsParent(slot)) ops.clear(slot.parent);
    else
      for (let i = 0; i < f.nodes.length; i++) {
        const nd = f.nodes[i];
        if (Array.isArray(nd)) for (const n of nd) ops.remove(n);
        else ops.remove(nd);
      }
  };

  const demote = (): void => {
    // Late-classic (contract carried from the patch-driver era): tear the
    // slot down whole, then re-enter classic insert under the ORIGINAL owner.
    if (IS_DEV) __unifiedForStats.demoted++;
    slot.dead = true;
    dropPending();
    // Demote DURING a hydrating fill: hand recorded claims back so classic's
    // re-run (same parity ids) claims the same server nodes.
    if (slot.hyd) slotHydration!.restore(slot);
    if (slot.flat !== null) {
      removeFlatDom();
      const f = slot.flat;
      for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
      slot.flat = null;
    }
    for (let r = slot.head; r !== null; r = r.x) {
      if (r.n !== null) ops.remove(r.n);
      else if (r.ns !== null) for (const n of r.ns) ops.remove(n);
    }
    slot.owner.dispose(false); // bulk: every row owner is a child
    slot.head = slot.tail = null;
    slot.size = 0;
    slot.map.clear();
    lateClassic();
  };

  /** Build the flat arrays for `arr` (tracked snapshot already taken by the
   * caller). Returns null when a row shape is outside the contract. */
  const buildFlat = (itemsSnap: any[]): FlatPlan | null => {
    const len = itemsSnap.length;
    const owners: RowOwner[] = new Array(len);
    const nodes: (Node | Node[])[] = new Array(len);
    let failed = false;
    const build = (): void => {
      runWithOwner(slot.owner as any, () => {
        for (let j = 0; j < len; j++) {
          const parts = buildParts(meta.row, itemsSnap[j], ops);
          if (parts === null) {
            // Dispose what this pass created before demoting.
            for (let d = 0; d < j; d++) owners[d].dispose();
            failed = true;
            return;
          }
          owners[j] = parts[0];
          nodes[j] = parts[1];
        }
      });
    };
    try {
      // Hydrating fill: row templates claim server nodes; record the claims
      // so a demote can hand them back to classic's re-run.
      if (slot.hyd) slotHydration!.record(slot, build);
      else build();
    } catch (e) {
      // A row fn threw mid-pass: rows built so far chain to the PERSISTENT
      // slot owner (by design — they survive compute reruns), so they'd leak
      // until slot death. Dispose, then let the throw ride the boundary.
      for (let d = 0; d < len; d++) owners[d]?.dispose();
      throw e;
    }
    if (failed) return null;
    return { ff: 1, mode: "fill", items: itemsSnap, owners, nodes, len };
  };

  // The insert owner disposes slot.owner (and with it every row) through the
  // owner tree — cleanup only has to silence the slot.
  onCleanup(() => {
    slot.dead = true;
  });

  effect(
    (): ComputeOut => {
      if (slot.dead) return IDENTICAL;
      // Read FIRST (phase separation, design H5): a NotReady here leaves the
      // slot untouched and rides the boundary like any compute throw.
      const items = meta.each();
      if (items != null && items !== false && !Array.isArray(items)) return DEMOTE;
      const arr: readonly any[] = items == null || items === false ? [] : items;
      // A superseded plan's fresh rows were never placed — discard, then
      // diff again from COMMITTED state (retry against uncorrupted state).
      dropPending();
      const len = arr.length;
      // ── FLAT MODE (lazy structure): aligned lists stay flat (zero work);
      // clears and no-survivor replaces stay flat (bulk swap); only a
      // PARTIAL structural op materializes the chain — once, amortized into
      // the op the chain's wins then repay.
      if (slot.flat !== null) {
        const fi = slot.flat.items;
        if (len === fi.length) {
          let aligned = true;
          for (let j = 0; j < len; j++)
            if (arr[j] !== fi[j]) {
              aligned = false;
              break;
            }
          if (aligned) return IDENTICAL;
        }
        if (len === 0)
          return (slot.pending = {
            ff: 1,
            mode: "clear",
            items: [],
            owners: [],
            nodes: [],
            len: 0
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
          const plan = buildFlat(snap);
          if (plan === null) return DEMOTE;
          plan.mode = "replace";
          return (slot.pending = plan);
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
          return (slot.pending = { ff: 1, mode: "fill", items: [], owners: [], nodes: [], len: 0 });
        }
        const snap: any[] = new Array(len);
        for (let j = 0; j < len; j++) snap[j] = arr[j];
        const plan = buildFlat(snap);
        return plan === null ? DEMOTE : (slot.pending = plan);
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
      try {
        runWithOwner(slot.owner as any, () => {
          for (let j = 0; j < width; j++) {
            const item = midItems[j];
            const at = oldIndexOf.get(item);
            if (at !== undefined) {
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
              if (built === null) {
                demoteFlag = true; // dynamic row shape (function top level)
                return;
              }
              fresh++;
              order[j] = built;
              oldPos[j] = -1;
            }
          }
        });
      } catch (e) {
        // A row fn threw mid-pass: fresh rows chain to the PERSISTENT slot
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
      for (let j = 0; j < oldRemain; j++) if (oldMid[j].g !== passGen) removes.push(oldMid[j]);
      return (slot.pending = { order, removes, before, after, len, fresh });
    },
    out => {
      if (out === IDENTICAL) return;
      if (out === DEMOTE) return demote();
      if ((out as FlatPlan).ff === 1) {
        const fp = out as FlatPlan;
        if (fp !== slot.pending) return; // superseded mid-flight
        slot.pending = null;
        if (fp.mode === "clear") {
          removeFlatDom();
          const f = slot.flat!;
          for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
          slot.flat = null;
          slot.size = 0;
          if (IS_DEV) __unifiedForStats.batchCleared++;
          return;
        }
        if (fp.mode === "replace") {
          removeFlatDom();
          const f = slot.flat!;
          for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
        }
        // Hydrating fill: a claim pass, not a placement pass — the hooks
        // reconcile claimed rows against the region (mismatch only).
        if (slot.hyd) return slotHydration!.commitFill(slot, fp);
        // fill / replace: append the new window before the end anchor.
        const tag = slot.end;
        for (let i = 0; i < fp.nodes.length; i++) {
          const nd = fp.nodes[i];
          if (Array.isArray(nd))
            for (const n of nd) {
              ops.insert(slot.parent, n, slot.end);
              if (tag) ops.tag(n, tag);
            }
          else {
            ops.insert(slot.parent, nd, slot.end);
            if (tag) ops.tag(nd, tag);
          }
        }
        slot.flat = { items: fp.items, owners: fp.owners, nodes: fp.nodes };
        slot.size = fp.len;
        return;
      }
      const plan = out as Plan;
      if (plan !== slot.pending) return; // superseded mid-flight
      slot.pending = null;
      const { order, removes, before, after } = plan;
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
          removeRow(removes[j], ops);
          slot.map.delete(removes[j].k);
        }
      }
      // 2. Place fresh/moved rows back-to-front so anchors are always final.
      let anchor: Node | null = after !== null ? firstNode(after) : slot.end;
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
    }
  );
  return true;
}

/** DEV-ONLY test probes: engagement / demotion / batch-clear counters.
 * Increments are IS_DEV-gated — frozen at zero in prod bundles (the export
 * itself is a few bytes; the double-underscore marks it non-API). */
export const __unifiedForStats = { engaged: 0, demoted: 0, batchCleared: 0 };
