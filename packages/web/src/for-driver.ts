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

interface Slot {
  head: Row | null;
  tail: Row | null;
  size: number;
  map: Map<any, Row>;
  parent: Node;
  end: Node | null;
  owner: RowOwner;
  pending: Plan | null;
  dead: boolean;
}

/** Pass generation counter (Row.g stamps). */
let gen = 0;

const firstNode = (r: Row): Node => (r.n !== null ? r.n : r.ns![0]);

/** Insert (fresh) or move (live) a row's nodes before `anchor`. */
function placeRow(slot: Slot, r: Row, anchor: Node | null): void {
  const tag = slot.end;
  if (r.n !== null) {
    slot.parent.insertBefore(r.n, anchor);
    if (tag && !r.live) (r.n as any)[$$SLOT] = tag;
  } else {
    const ns = r.ns!;
    for (let i = 0; i < ns.length; i++) {
      slot.parent.insertBefore(ns[i], anchor);
      if (tag && !r.live) (ns[i] as any)[$$SLOT] = tag;
    }
  }
  if (!r.live) {
    r.live = true;
    slot.map.set(r.k, r);
  }
}

function removeRow(r: Row): void {
  if (r.live) {
    if (r.n !== null) (r.n as ChildNode).remove();
    else for (const n of r.ns!) (n as ChildNode).remove();
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
function buildRow(rowFn: (item: any) => any, item: any): Row | null {
  // Measurement flag: ambient (slot) ownership, no per-row owner. Removed
  // rows leak their effect until slot teardown — bench-only semantics.
  const o: RowOwner = __ownerlessRows ? NO_OWNER : (createOwner() as unknown as RowOwner);
  let v = __ownerlessRows ? rowFn(item) : runWithOwner(o as any, () => rowFn(item));
  if (v != null && (v as any).nodeType !== undefined)
    return { k: item, o, n: v as Node, ns: null, p: null, x: null, live: false, mv: true, g: 0 };
  const t = typeof v;
  if (t === "string" || t === "number") {
    const n = document.createTextNode(String(v));
    return { k: item, o, n, ns: null, p: null, x: null, live: false, mv: true, g: 0 };
  }
  // Slow path: fragments / nested arrays / signals — flatten (still owned).
  v = __ownerlessRows
    ? flatten(v, FLATTEN_OPTS)
    : runWithOwner(o as any, () => flatten(v, FLATTEN_OPTS));
  if (Array.isArray(v) && v.length > 0) {
    const ns: Node[] = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if (typeof c === "function") return (o.dispose(), null);
      ns[i] = (c as any)?.nodeType ? (c as Node) : document.createTextNode(String(c));
    }
    return { k: item, o, n: null, ns, p: null, x: null, live: false, mv: true, g: 0 };
  }
  if (v != null && (v as any).nodeType !== undefined)
    return { k: item, o, n: v as Node, ns: null, p: null, x: null, live: false, mv: true, g: 0 };
  o.dispose();
  return null; // function / empty / unrenderable top level → classic
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
type ComputeOut = Plan | typeof IDENTICAL | typeof DEMOTE;

function driveKeyedFor(
  parent: Node,
  listFn: any,
  marker: Node | undefined,
  lateClassic: () => void
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
    pending: null,
    dead: false
  };
  __unifiedForStats.engaged++;

  const dropPending = (): void => {
    if (slot.pending !== null) {
      const { order } = slot.pending;
      for (let j = 0; j < order.length; j++) if (!order[j].live) order[j].o.dispose();
      slot.pending = null;
    }
  };

  const demote = (): void => {
    // Late-classic (contract carried from the patch-driver era): tear the
    // slot down whole, then re-enter classic insert under the ORIGINAL owner.
    __unifiedForStats.demoted++;
    slot.dead = true;
    dropPending();
    for (let r = slot.head; r !== null; r = r.x) {
      if (r.n !== null) (r.n as ChildNode).remove();
      else if (r.ns !== null) for (const n of r.ns) (n as ChildNode).remove();
    }
    slot.owner.dispose(false); // bulk: every row owner is a child
    slot.head = slot.tail = null;
    slot.size = 0;
    slot.map.clear();
    lateClassic();
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
            const built = buildRow(meta.row, item);
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
      const plan = out as Plan;
      if (plan !== slot.pending) return; // superseded mid-flight
      slot.pending = null;
      const { order, removes, before, after } = plan;
      // Batch clear (design §5.2): N→0 on a whole-parent slot is one
      // `textContent = ''` + one bulk owner dispose — no per-row work.
      if (plan.len === 0 && slot.end === null && before === null && after === null) {
        __unifiedForStats.batchCleared++;
        (slot.parent as Element).textContent = "";
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
        (slot.parent as Element).textContent = "";
        for (let j = 0; j < removes.length; j++) {
          removes[j].live = false;
          removes[j].o.dispose();
        }
        slot.map.clear();
      } else {
        // 1. Removes: detach + dispose + unmap.
        for (let j = 0; j < removes.length; j++) {
          removeRow(removes[j]);
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
  setListDriver(driveKeyedFor);
}

/** Spike test probes: engagement / demotion / batch-clear counters. */
export const __unifiedForStats = { engaged: 0, demoted: 0, batchCleared: 0 };
