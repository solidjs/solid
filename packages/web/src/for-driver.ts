/**
 * Unified For driver (SPIKE — DESIGN-UNIFIED-FOR.md).
 *
 * One persistent structure owns both the row bookkeeping AND the DOM
 * placement for a keyed <For>: an intrusive doubly-linked chain of rows plus
 * an incrementally-maintained key→row Map, per engaged list. The update is
 * pull-based — an ordinary two-phase render effect reads `each()`, diffs
 * against its own committed chain (prefix walk, suffix walk, middle
 * partition + LIS), and commits placement — no delivery seam, no message
 * channel, no second diff: mapArray and reconcileArrays are both bypassed
 * for engaged lists.
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
import { createOwner, runWithOwner, flatten, onCleanup, sharedConfig } from "solid-js";
import { effect } from "./render.js";
import { $$SLOT } from "./constants.js";
import { setListDriver } from "./client.js";

type RowOwner = { dispose(self?: boolean): void };

interface Row {
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
interface Flat {
  /** Committed item snapshot (identity keys). */
  items: any[];
  owners: RowOwner[];
  nodes: (Node | Node[])[];
}

interface FlatPlan {
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
}

/** Web's ops singleton — the one instance every web slot shares. */
const domOps: SlotOps = {
  insert(parent, node, anchor) {
    parent.insertBefore(node, anchor);
  },
  remove(node) {
    (node as ChildNode).remove();
  },
  createText(text) {
    return document.createTextNode(text);
  },
  isNode(v) {
    return v != null && (v as any).nodeType !== undefined;
  },
  clear(parent) {
    (parent as Element).textContent = "";
  },
  tag(node, marker) {
    (node as any)[$$SLOT] = marker;
  }
};

interface Slot {
  head: Row | null;
  tail: Row | null;
  size: number;
  map: Map<any, Row>;
  parent: Node;
  end: Node | null;
  owner: RowOwner;
  flat: Flat | null;
  pending: Plan | FlatPlan | null;
  dead: boolean;
  ops: SlotOps;
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

/** Shared no-op owner for the ownerless measurement mode. */
const NO_OWNER: RowOwner = { dispose() {} };

/** Build a row under its own owner (untracked + owned via runWithOwner —
 * mapArray's per-row shape). Fast path: compiled single-root rows return an
 * element directly and skip flatten. Detached DOM only — placement is the
 * commit's job. Returns null when the row shape is outside the spike
 * contract. MUST run inside `runWithOwner(slot.owner, ...)` so the row
 * owner chains to the slot (context + auto-teardown). */
/** Row-body build core: owner + detached DOM, no bookkeeping. Returns
 * [owner, node|nodes] or null (shape outside contract). Shared by the flat
 * fill (arrays only) and structural buildRow (wraps into a Row). */
function buildParts(
  rowFn: (item: any) => any,
  item: any,
  ops: SlotOps
): [RowOwner, Node | Node[]] | null {
  // Measurement flag: ambient (slot) ownership, no per-row owner. Removed
  // rows leak their effect until slot teardown — bench-only semantics.
  const o: RowOwner = __ownerlessRows ? NO_OWNER : (createOwner() as unknown as RowOwner);
  let v = __ownerlessRows ? rowFn(item) : runWithOwner(o as any, () => rowFn(item));
  if (ops.isNode(v)) return [o, v as Node];
  const t = typeof v;
  if (t === "string" || t === "number") return [o, ops.createText(String(v))];
  // Slow path: fragments / nested arrays / signals — flatten (still owned).
  v = __ownerlessRows
    ? flatten(v, FLATTEN_OPTS)
    : runWithOwner(o as any, () => flatten(v, FLATTEN_OPTS));
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
  o.dispose();
  return null; // function / empty / unrenderable top level → classic
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

function driveKeyedFor(
  parent: Node,
  listFn: any,
  marker: Node | undefined,
  lateClassic: () => void,
  ops: SlotOps
): boolean {
  const meta = listFn.$for;
  // H4 pin: keyed-fn rows receive accessors in the classic contract — the
  // driver binds raw items, so engaging would hand user code the wrong shape.
  if (typeof meta.keyed === "function") return false;
  // Hydration claiming is post-spike (design §6 H2): decline to classic.
  if (sharedConfig.hydrating) return false;

  const slot: Slot = {
    head: null,
    tail: null,
    size: 0,
    map: new Map(),
    parent,
    end: marker ?? null,
    // Slot owner under the INSERT context: rows inherit context through it,
    // survive compute reruns, and tear down automatically with the
    // component — cleanup needs no row walk.
    owner: createOwner() as unknown as RowOwner,
    flat: null,
    pending: null,
    dead: false,
    ops
  };
  __unifiedForStats.engaged++;

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
    if (slot.end === null) ops.clear(slot.parent);
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
    __unifiedForStats.demoted++;
    slot.dead = true;
    dropPending();
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
        if (len === 0) return IDENTICAL;
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
              demoteFlag = true; // dynamic/empty row shape
              return;
            }
            fresh++;
            order[j] = built;
            oldPos[j] = -1;
          }
        }
      });
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
          __unifiedForStats.batchCleared++;
          return;
        }
        if (fp.mode === "replace") {
          removeFlatDom();
          const f = slot.flat!;
          for (let i = 0; i < f.owners.length; i++) f.owners[i].dispose();
        }
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
      // Batch clear (design §5.2): N→0 on a whole-parent slot is one
      // `textContent = ''` + one bulk owner dispose — no per-row work.
      if (plan.len === 0 && slot.end === null && before === null && after === null) {
        __unifiedForStats.batchCleared++;
        ops.clear(slot.parent);
        slot.owner.dispose(false);
        slot.map.clear();
        slot.head = slot.tail = null;
        slot.size = 0;
        return;
      }
      // Full replace (no survivors, whole-parent): bulk-detach the old rows
      // with one textContent write, dispose them without per-node removes,
      // and let the placement walk below append the fresh window. Covers the
      // jfb `replace` / `runlots`-over-rows shapes.
      if (
        slot.end === null &&
        before === null &&
        after === null &&
        removes.length === slot.size &&
        removes.length > 0
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

/** MEASUREMENT-ONLY spike flag (never product): skip per-row owners
 * entirely — rows run with the SLOT owner ambient, so row effects chain to
 * the slot and individual row disposal is a no-op (removed rows leak their
 * effect until slot teardown). Quantifies the per-row ownership tax
 * (createOwner + runWithOwner + dispose) that a compiler-proven
 * single-effect row contract would eliminate soundly. */
export let __ownerlessRows = false;

/** Arm the unified For driver (spike registration — pay-for-use: `insert`
 * is in every bundle; the driver rides only apps that call this). */
export function enableUnifiedFor(options?: { unsafeOwnerlessRows?: boolean }): void {
  __ownerlessRows = options?.unsafeOwnerlessRows === true;
  // Web hands the slot ITS platform: the domOps singleton. (Interim wiring —
  // the module-graph landing passes ops at insert's engagement site instead.)
  setListDriver((parent, listFn, marker, lateClassic) =>
    driveKeyedFor(parent, listFn, marker, lateClassic, domOps)
  );
}

/** Spike test probes: engagement / demotion / batch-clear counters. */
export const __unifiedForStats = { engaged: 0, demoted: 0, batchCleared: 0 };
