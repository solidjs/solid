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
 * PHASE DISCIPLINE (the H1 bet): the COMPUTE half reads, diffs, and may
 * create fresh rows as DETACHED DOM (same legality as template cloning in
 * classic computes), but never touches the live document or the committed
 * chain. The EFFECT half is the only writer of both. Under a held
 * transition the effect doesn't run until reveal, so the slot can never
 * half-apply speculative state; a re-compute before the effect (transition
 * retry, rapid writes) discards the superseded plan's fresh rows and diffs
 * again from committed state — the "retry against uncorrupted state"
 * contract mapArray's strong-abort ordering exists to provide, here free by
 * construction.
 *
 * SPIKE SCOPE — declines (pre-engage) or late-classic demotes (post-engage)
 * rather than implements: hydration claiming (H2), `keyed` functions
 * (accessor-row contract, H4), duplicate keys, rows whose top level is a
 * FUNCTION (dynamic top-level content), empty-rendering rows, and non-array
 * subjects. Every decline lands on the classic mapArray path.
 */
import { flatten, onCleanup, sharedConfig, createRoot, untrack } from "solid-js";
import { effect } from "./render.js";
import { $$SLOT } from "./constants.js";
import { setListDriver } from "./client.js";

interface Row {
  /** Row key — the item reference itself (identity mode only in the spike). */
  k: any;
  /** Root disposer for the row's owned scope. */
  d: () => void;
  /** Single-root fast form (the common compiled shape)... */
  n: Node | null;
  /** ...or the fragment form (multi-root rows); exactly one of n/ns is set. */
  ns: Node[] | null;
  p: Row | null;
  x: Row | null;
  /** True once the effect phase has placed the row into live DOM. */
  live: boolean;
}

interface Plan {
  /** Final row order for the CHANGED middle window only. */
  order: Row[];
  /** Rows needing placement this commit (fresh or moved). */
  place: Set<Row>;
  /** Committed rows leaving the list — detach + dispose at commit. */
  removes: Row[];
  /** Chain splice boundaries: last untouched prefix row / first untouched
   * suffix row (null = list edge). */
  before: Row | null;
  after: Row | null;
  /** List length after this plan applies. */
  len: number;
}

interface Slot {
  head: Row | null;
  tail: Row | null;
  size: number;
  map: Map<any, Row>;
  parent: Node;
  end: Node | null;
  pending: Plan | null;
  dead: boolean;
}

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
  r.d();
}

/** Build a row: owned root, body called untracked (component semantics),
 * result flattened WITHOUT unwrap so a top-level function is detectable
 * (declined). Detached DOM only — placement is the commit's job. Returns
 * null when the row shape is outside the spike contract. */
function buildRow(rowFn: (item: any) => any, item: any): Row | null {
  let out: Row | null = null;
  const dispose = createRoot(d => {
    const v = flatten(
      untrack(() => rowFn(item)),
      { skipNonRendered: true, doNotUnwrap: true }
    );
    if (typeof v === "function") return d;
    if (Array.isArray(v)) {
      if (v.length === 0) return d;
      const ns: Node[] = new Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const c = v[i];
        ns[i] = (c as any)?.nodeType ? (c as Node) : document.createTextNode(String(c));
      }
      out = { k: item, d, n: null, ns, p: null, x: null, live: false };
    } else {
      const n: Node = (v as any)?.nodeType ? (v as Node) : document.createTextNode(String(v ?? ""));
      out = { k: item, d, n, ns: null, p: null, x: null, live: false };
    }
    return d;
  });
  if (out === null) dispose();
  return out;
}

/** Longest increasing subsequence over old-middle indices (-1 = fresh row).
 * Returns the set of `order` positions that KEEP their DOM position. */
function stablePositions(oldPos: number[]): Set<number> {
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev: number[] = new Array(oldPos.length).fill(-1);
  for (let i = 0; i < oldPos.length; i++) {
    const v = oldPos[i];
    if (v === -1) continue;
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    tailIdx[lo] = i;
  }
  const keep = new Set<number>();
  let at = tails.length > 0 ? tailIdx[tails.length - 1] : -1;
  while (at !== -1) {
    keep.add(at);
    at = prev[at];
  }
  return keep;
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
    pending: null,
    dead: false
  };

  const dropPending = (): void => {
    if (slot.pending !== null) {
      for (const r of slot.pending.place) if (!r.live) r.d();
      slot.pending = null;
    }
  };

  const demote = (): void => {
    // Late-classic (contract carried from the patch-driver era): tear the
    // slot down whole, then re-enter classic insert under the ORIGINAL owner.
    __unifiedForStats.demoted++;
    slot.dead = true;
    dropPending();
    for (let r = slot.head; r !== null; r = r.x) removeRow(r);
    slot.head = slot.tail = null;
    slot.size = 0;
    slot.map.clear();
    lateClassic();
  };

  __unifiedForStats.engaged++;
  onCleanup(() => {
    slot.dead = true;
    dropPending();
    for (let r = slot.head; r !== null; r = r.x) r.d();
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
      // ── Old middle rows, keyed for reuse.
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
      // ── New middle: reuse by key, build the rest (detached).
      const width = end - i + 1;
      const order: Row[] = new Array(width);
      const oldPos: number[] = new Array(width);
      const reused = new Set<Row>();
      for (let j = 0; j < width; j++) {
        const item = arr[i + j];
        const at = oldIndexOf.get(item);
        if (at !== undefined) {
          const row = oldMid[at];
          if (reused.has(row)) return DEMOTE; // duplicate incoming key
          reused.add(row);
          order[j] = row;
          oldPos[j] = at;
        } else if (slot.map.has(item)) {
          // Same identity alive outside the middle window = duplicate key
          // across the prefix/suffix boundary. Classic owns duplicates.
          return DEMOTE;
        } else {
          const fresh = buildRow(meta.row, item);
          if (fresh === null) return DEMOTE; // dynamic/empty row shape
          order[j] = fresh;
          oldPos[j] = -1;
        }
      }
      const keep = stablePositions(oldPos);
      const place = new Set<Row>();
      for (let j = 0; j < width; j++) if (!keep.has(j)) place.add(order[j]);
      const removes: Row[] = [];
      for (let j = 0; j < oldRemain; j++) if (!reused.has(oldMid[j])) removes.push(oldMid[j]);
      return (slot.pending = { order, place, removes, before, after, len });
    },
    out => {
      if (out === IDENTICAL) return;
      if (out === DEMOTE) return demote();
      const plan = out as Plan;
      if (plan !== slot.pending) return; // superseded mid-flight
      slot.pending = null;
      const { order, place, removes, before, after } = plan;
      // 1. Removes: detach + dispose + unmap.
      for (let j = 0; j < removes.length; j++) {
        removeRow(removes[j]);
        slot.map.delete(removes[j].k);
      }
      // 2. Place fresh/moved rows back-to-front so anchors are always final.
      let anchor: Node | null = after !== null ? firstNode(after) : slot.end;
      for (let j = order.length - 1; j >= 0; j--) {
        const r = order[j];
        if (place.has(r)) placeRow(slot, r, anchor);
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

/** Arm the unified For driver (spike registration — pay-for-use: `insert`
 * is in every bundle; the driver rides only apps that call this). */
export function enableUnifiedFor(): void {
  setListDriver(driveKeyedFor);
}

/** Spike test probes: engagement / late-classic-demotion counters. */
export const __unifiedForStats = { engaged: 0, demoted: 0 };
