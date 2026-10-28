/**
 * Store — optimistic stores on lanes (plan sec. 31, S4; INTERNALS §3/§7, RUL-3).
 *
 * No store-side layer, no backup snapshots, no retaining ledger: a user
 * write to an optimistic store is a GUESS on the written key's node
 * (`optimisticWrite` — the same write `createOptimistic`'s setter makes),
 * a presence guess on its presence node, and, when membership or
 * arrangement changed, an arrangement guess on the container node. Lanes
 * do the rest: the guess shows under the action's hold, a landing beneath
 * it stages as truth and confirms it when equal (A18/A24), the action's
 * settle dissolves it (a revert to the value it covered, or the landed
 * truth). The committed backing is never touched by a guess.
 *
 * Reads compose: a reader of an overlaid target sees the truth it is served
 * with the lanes' values over it (`optimisticView` — per node, by the same
 * rule a leaf read follows: what the lane shows).
 *
 * Landings (Q-D, plan sec. 31.7): the derive's output is reconciled against the
 * optimistic VIEW — a row the guess added and the server returns with the
 * same key in the same position keeps its proxy (the row target adopts the
 * server object), its leaves write truth beneath their guesses, and the
 * container's arrangement guess is confirmed silently (`LaneView`'s
 * comparator) — `For` does not run. Retained-setter replay (the
 * 2026-08-31b continuation half) is not built here; the matrix decides.
 */
import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_OVERRIDE,
  CONFIG_SLOT_NODE,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_REASK,
  STATUS_PENDING
} from "../core/constants.js";
import { computed, ext, isEqual, joinPassAt, read as readNode, untrack } from "../core/core.js";
import { laneValueOf, optimisticWrite, pendingGuessOf, take } from "../core/lanes.js";
import { getOwner } from "../core/owner.js";
import {
  clock,
  GlobalQueue,
  insertSubs,
  joinFuture,
  laneDirty,
  list,
  merge,
  notifyEpoch,
  passLane,
  resolveTx,
  schedule,
  txOf,
  type Transaction
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { Refreshable } from "../core/index.js";
import { runProjectionComputed } from "./projection.js";
import { reconcileState } from "./reconcile.js";
import {
  cloneRaw,
  committed,
  getContainerNode,
  getHasNode,
  getNode,
  LaneView,
  nameStore,
  resolveChainedRaw,
  sameKey,
  storeSetter,
  targetsEqual,
  unwrapValue,
  wrap
} from "./store.js";
import { installOptHooks } from "./hooks.js";
import { $OWNER, lookupTarget, type StoreFamily, type StoreTarget } from "./target.js";
import {
  $TARGET,
  $TRACK,
  isWrappable,
  markRawIngest,
  type NoArray,
  type NoFn,
  type ProjectionOptions,
  type Store,
  type StoreOptions,
  type StoreSetter
} from "./types.js";

const hasOwn = Object.prototype.hasOwnProperty;

/** A user setter's writes on an optimistic family, as guesses: one per
 * changed key's leaf, one per presence change, the container's arrangement
 * when membership or order changed. `pb` is the draft (a clone of the view
 * the user saw); `old` the view it composed on. */
/** An optimistic setter's targets whose staging was set aside (`draft`),
 * restored when the setter's writes become guesses (`writes`). */
const optStaged: Map<StoreTarget, Record<PropertyKey, any>> = new Map();

// A chained backing is a proxy: reading it as a handler can expose a
// derived store's staging. Compose the writer's view on the committed
// backing of each link, retaining any optimistic guesses on that link.
function writerBacking(t: StoreTarget): Record<PropertyKey, any> {
  const base = committed(t);
  const inner: StoreTarget | undefined = (base as any)[$TARGET];
  return inner === undefined
    ? base
    : optimisticView(inner, writerBacking(inner), laneValueOf, true);
}

/** The user's draft on an optimistic family: a clone of the view the user
 * saw — the committed frame with the lanes' values and the tick's own
 * unflushed guesses over it (#3665). A staging already on the target (a
 * landing adopted this flush) is set aside for the setter's duration: the
 * guesses go over it, it stays the truth beneath. */
function optimisticDraft(t: StoreTarget): Record<PropertyKey, any> {
  if (t.pb !== null) optStaged.set(t, t.pb);
  return cloneRaw(optimisticView(t, writerBacking(t), laneValueOf, true), t);
}

export function notifyOptimisticWrites(
  t: StoreTarget,
  pb: Record<PropertyKey, any>
): Record<PropertyKey, any> | null {
  // The view the user saw: the committed frame (a staging adopted eagerly
  // is not it) with the lanes' values and the tick's own guesses over it.
  const base = writerBacking(t);
  const old = optimisticView(t, base, laneValueOf, true);
  const isArr = Array.isArray(pb);
  // A chained target's nodes are links (§7b): their committed value is
  // never served and never learns the inner store's commits — yet a guess
  // is judged against it, and reverts to it (#3672). Hand the node the
  // inner store's truth for its key before guessing over it.
  const inner = t.ch ? (t.v as Record<PropertyKey, any>) : null;
  const guess = (node: Signal<any>, key: PropertyKey, presence: boolean, nv: unknown): void => {
    if (inner !== null) node._value = presence ? key in base : unwrapValue(base[key as any]);
    // By value: a function leaf is a value, not an updater (#3017).
    optimisticWrite(node, () => nv);
  };
  let structural = false;
  for (const key of Reflect.ownKeys(pb)) {
    if ((isArr && key === "length") || key === $OWNER) continue;
    // A chained draft holds the inner store's raws; a raw is the inner slot it
    // resolves to (as a read of it serves) — the row a held write staged is
    // the same row, not a guess over the slot (#3796).
    const raw = pb[key as any];
    const nv = unwrapValue(inner && raw ? resolveChainedRaw(t, key, raw) : raw);
    if (!(key in old)) {
      guess(getNode(t, key), key, false, nv);
      guess(getHasNode(t, key), key, true, true);
      structural = true;
    } else {
      const previous = old[key as any];
      const ov = unwrapValue(inner && previous ? resolveChainedRaw(t, key, previous) : previous);
      if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) {
        guess(getNode(t, key), key, false, nv);
        if (isArr) structural = true;
      }
    }
  }
  for (const key of Reflect.ownKeys(old)) {
    if ((isArr && key === "length") || key === $OWNER) continue;
    if (key in pb) continue;
    guess(getNode(t, key), key, false, undefined);
    guess(getHasNode(t, key), key, true, false);
    structural = true;
  }
  if (isArr && (old as any[]).length !== (pb as any[]).length) {
    guess(getNode(t, "length"), "length", false, (pb as any[]).length);
    structural = true;
  }
  if (structural) {
    const rows = isArr ? (pb as any[]).map(unwrapValue) : shallowKeys(pb);
    // The rows the setter removed from the view it saw, by key: a later
    // re-base over another action's truth must not bring them back. A set
    // (empty or not) marks a keyed arrangement guess (`fold`).
    let removed: Set<unknown> | null = null;
    const keyFn = t.fam!.key;
    if (isArr && keyFn !== null && keyFn !== undefined) {
      removed = new Set();
      const kept = new Set<unknown>();
      for (let i = 0; i < rows.length; i++) {
        const k = isWrappable(rows[i]) ? keyFn(rows[i]) : undefined;
        if (k !== undefined) kept.add(k);
      }
      for (let i = 0; i < (old as any[]).length; i++) {
        const r = unwrapValue((old as any[])[i]);
        const k = isWrappable(r) ? keyFn(r) : undefined;
        if (k !== undefined && !kept.has(k)) removed.add(k);
      }
    }
    optimisticWrite(getContainerNode(t), new LaneView(rows, base, removed) as any);
  }
  if (t.dk !== null) optimisticWrite(t.dk, {} as any);
  markOverlaid(t);
  const staged = optStaged.get(t);
  if (staged === undefined) return null;
  optStaged.delete(t);
  return staged;
}

type KeyFn = (item: any) => any;

/** The container comparator's lane arm (store.ts `containerEquals`): an
 * arrangement guess (`LaneView`) against a landing or another arrangement,
 * by row identity — by key when the family has one. */
function arrangement(t: StoreTarget, a: any, b: any): boolean {
  const av = a instanceof LaneView;
  const bv = b instanceof LaneView;
  if (!av && !bv) return false;
  return arrangementEqual(av ? a.rows : a, bv ? b.rows : b, t.fam?.key ?? null);
}

function rowSame(a: any, b: any, keyFn: ((item: any) => any) | null): boolean {
  if (isEqual(a, b) || targetsEqual(a, b)) return true;
  if (keyFn === null || !isWrappable(a) || !isWrappable(b)) return false;
  const ka = keyFn(unwrapValue(a));
  const kb = keyFn(unwrapValue(b));
  // Keyless rows are identified by position — reconcile's fallback when the
  // key is missing. The caller already paired these by index, so two keyless
  // rows are the same row and the landing confirms the arrangement instead of
  // dissolving it. Dissolving held an external echo under the action, and a
  // mainline `until` then timed out on a source that already contained it
  // (#3898). Keyed rows still match only on the key.
  if (ka === undefined && kb === undefined) return true;
  return ka !== undefined && sameKey(ka, kb);
}

/** Whether reconcile would write anything into `a` from `b`: wrappable
 * pairs descend, leaves compare as its writes do. A key mismatch is a
 * replacement, which a content difference already says. Plain data — the
 * server's echo of a guessed row is a new object with the same contents. */
function echoes(a: any, b: any): boolean {
  if (a === b) return true;
  if (!isWrappable(a) || !isWrappable(b)) return false;
  a = unwrapValue(a);
  b = unwrapValue(b);
  const ak = Object.keys(a);
  if (Array.isArray(a) !== Array.isArray(b) || ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (!hasOwn.call(b, k) || !echoes(a[k], b[k])) return false;
  return true;
}
// A cycle (a row that references itself) is not plain data: no match, so
// the landing stays a correction.
GlobalQueue._echoes = (a, b) => {
  try {
    return echoes(a, b);
  } catch {
    return false;
  }
};

function arrangementEqual(
  a: Record<PropertyKey, any>,
  b: Record<PropertyKey, any>,
  keyFn: ((item: any) => any) | null
): boolean {
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as any[]).length) return false;
    for (let i = 0; i < a.length; i++) if (!rowSame(a[i], (b as any[])[i], keyFn)) return false;
    return true;
  }
  const ak = Reflect.ownKeys(a).filter(k => k !== $OWNER);
  const bk = Reflect.ownKeys(b).filter(k => k !== $OWNER);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!(k in b)) return false;
  return true;
}

/** Write `incoming` into the draft `draft` (a store proxy inside a user's
 * setter): arrays match rows by key (position when unkeyed) and recurse into
 * the matched row's draft; objects recurse into a wrappable pair, assign
 * otherwise; keys `incoming` lacks are deleted. */
function reconcileDraft(draft: any, incoming: any, keyFn: KeyFn | null): void {
  if (Array.isArray(incoming)) {
    const n = draft.length as number;
    const prev: any[] = new Array(n);
    for (let i = 0; i < n; i++) prev[i] = draft[i];
    let byKey: Map<any, any> | null = null;
    if (keyFn !== null) {
      byKey = new Map();
      for (let i = 0; i < n; i++) {
        const raw = unwrapValue(prev[i]);
        if (!isWrappable(raw)) continue;
        const k = keyFn(raw);
        if (k !== undefined && !byKey.has(k)) byKey.set(k, prev[i]);
      }
    }
    for (let i = 0; i < incoming.length; i++) {
      const nv = incoming[i];
      let match: any;
      if (isWrappable(nv)) {
        if (byKey !== null) {
          const k = keyFn!(nv);
          if (k !== undefined) match = byKey.get(k);
        } else if (i < n && isWrappable(unwrapValue(prev[i]))) match = prev[i];
      }
      if (match !== undefined) {
        if (unwrapValue(match) !== nv) reconcileDraft(match, nv, keyFn);
        if (draft[i] !== match) draft[i] = match;
      } else if (unwrapValue(draft[i]) !== nv) draft[i] = nv;
    }
    if (draft.length !== incoming.length) draft.length = incoming.length;
    return;
  }
  for (const k of Object.keys(incoming)) {
    const nv = incoming[k];
    const cur = draft[k];
    const curRaw = unwrapValue(cur);
    if (
      isWrappable(nv) &&
      isWrappable(curRaw) &&
      Array.isArray(nv) === Array.isArray(curRaw) &&
      (keyFn === null || Array.isArray(nv) || sameKey(keyFn(nv), keyFn(curRaw)))
    ) {
      if (curRaw !== nv) reconcileDraft(cur, nv, keyFn);
    } else if (curRaw !== nv) draft[k] = nv;
  }
  for (const k of Object.keys(draft)) if (!(k in incoming)) delete draft[k];
}

/** Core asks (lanes `laneWrite`): the family's derive, re-asking in a lane of
 * another action than the one that guessed this slot, writes it — that
 * lane's new question, which the guess (over the old one) does not answer:
 * the slot is the lane's derivation from here (F-6, #4336; lanes
 * `laneStage` for a node's own pass). */
GlobalQueue._slotTake = (n, back) => {
  const t = (n as any)._host as StoreTarget | undefined;
  if (back) {
    // The guess comes back (lanes `endLanes`): on the slot's node now — the
    // node itself, or the one a read made after it was released.
    const k = (n as any)._key;
    markOverlaid(t!);
    return k === $TRACK
      ? getContainerNode(t!)
      : n._equals === isEqual
        ? getHasNode(t!, k)
        : getNode(t!, k);
  }
  const d = t?.fam?.node?._x?._transaction;
  const g = txOf(n);
  if (!d?._lane || sameAction(d, g)) return false;
  // The re-ask takes the target's guess whole: the slot is the lane's
  // derivation; its other guessed slots show their truth in the lane's
  // world (lanes `take`).
  for (const m of nodesOf(t!)) if (m?._config & CONFIG_GUESS && txOf(m) === g) take(m, d, m !== n);
  return true;
};
/** Q-D (plan sec. 39): an OLDER question's truth landed beneath an arrangement
 * guess (`laneWrite` held it — another action's landing is not this guess's
 * answer). The guess is re-based over it: order from the guess, rows from
 * the truth by key (a guessed row the truth has is the truth's object — the
 * row target adopted it, its proxy survives), guessed rows the truth lacks
 * kept (the guess's own landing judges them), truth rows the guess lacks
 * appended. The composed arrangement becomes the lane's value on every
 * index whose row the committed backing does not already show — compared
 * BY KEY, never by raw identity: the same key's new object is the same row
 * (its target adopted it) and the slot stays the committed backing's — (a
 * node is born for it as the lane's derivation), on `length` only when the
 * committed length differs, and as the `LaneView`'s base for structural
 * reads. Unkeyed families compose
 * positionally — the guess stands as written (the documented residue). */
GlobalQueue._laneRebase = (el: Signal<any>, truth: unknown, older: boolean) => {
  if (!older) return fold(el, truth);
  const t = (el as any)._host as StoreTarget | undefined;
  if (t === undefined || (el as any)._key !== $TRACK) return;
  const view = el._x!._lane;
  if (!(view instanceof LaneView)) return;
  if (!Array.isArray(truth) || !Array.isArray(view.rows)) {
    view.base = truth as Record<PropertyKey, any>;
    return;
  }
  const keyFn = t.fam?.key ?? null;
  if (keyFn === null) return;
  const byKey = new Map<unknown, any>();
  for (let i = 0; i < truth.length; i++) {
    const r = truth[i];
    const k = isWrappable(r) ? keyFn(r) : undefined;
    if (k !== undefined && !byKey.has(k)) byKey.set(k, r);
  }
  const used = new Set<unknown>();
  const rows: any[] = [];
  const guessed = view.rows as any[];
  for (let i = 0; i < guessed.length; i++) {
    const g = guessed[i];
    const k = isWrappable(g) ? keyFn(g) : undefined;
    const tr = k !== undefined ? byKey.get(k) : undefined;
    if (tr !== undefined) {
      rows.push(tr);
      used.add(k);
    } else rows.push(g);
  }
  const removed = view.removed;
  for (let i = 0; i < truth.length; i++) {
    const r = truth[i];
    const k = isWrappable(r) ? keyFn(r) : undefined;
    if (k !== undefined && !used.has(k) && (removed === null || !removed.has(k))) rows.push(r);
  }
  view.rows = rows;
  view.base = rows;
  const lane = txOf(el);
  const base = committed(t) as any[];
  const nodes = t.n;
  for (let i = 0; i < rows.length; i++) {
    const node = nodes?.[i];
    // A slot the lane does not own shows the committed row: it becomes the
    // lane's only where the composed row is another row (by key — the same
    // key's new object is the same row, its target adopted it).
    if (node === undefined) {
      if (!sameRow(base[i], rows[i], keyFn)) laneSet(getNode(t, i), rows[i], lane);
    } else if (!sameRow(node._config & CONFIG_OVERRIDE ? node._x!._lane : base[i], rows[i], keyFn))
      laneSet(node, rows[i], lane);
  }
  if (nodes !== null) {
    for (let i = rows.length; ; i++) {
      const node = nodes[i];
      if (node === undefined) break;
      laneSet(node, undefined, lane);
    }
    const len = nodes.length;
    if (len !== undefined && (len._config & CONFIG_OVERRIDE || base.length !== rows.length))
      laneSet(len, rows.length, lane);
  }
};

/** D-34 for a keyed arrangement guess: rows by key, not positions. A
 * current truth that differs folds into the hold beneath it instead of
 * voiding the lane: the guess stays the lane's value and the screen's until
 * the hold commits, where rows match by key, and the graph outside the lane
 * re-derives from the truth now (`foldedRead`). A confirmation is silent
 * (A17): only truth readers are told. True: the lane stages the truth
 * beneath (`laneWrite`). */
function fold(el: Signal<any>, truth: unknown): boolean {
  const k = ((el as any)._host as StoreTarget | undefined)?.k;
  const l = txOf(el);
  // A guess the screen never showed is void at the correction (D-34); a
  // keyed arrangement guess's view carries its removed-keys set.
  if (!l._shown || !(k?._config! & CONFIG_OVERRIDE) || !(k!._x!._lane as LaneView)?.removed)
    return false;
  const guess = el._x!._lane;
  if ((!el._equals || !el._equals(guess, truth)) && !GlobalQueue._echoes!(guess, truth)) {
    l.folded = foldedRead;
    insertSubs(el);
  } else GlobalQueue._confirmed?.(l);
  joinFuture(resolveTx(l._parent ?? l));
  return true;
}

/** A folded lane's guess read by a deriving pass outside the lane, tracked
 * or not (`untrack` is about dependencies, not about which world a pass
 * derives from), or by `latest()` (`c` null): the hold's world — the truth
 * staged beneath the guess, else the value it covered — and the pass joins
 * the hold. Lane passes and the screen keep the guess: held truth is masked
 * from lane passes only (#3164). The store's own derive reconciles its
 * landings against the arrangement the guesses made: it is the author, not
 * a reader. */
function foldedRead(c: Computed<any> | null, el: Signal<any> | Computed<any>): unknown {
  if (c !== null) {
    if (
      !(el._config & CONFIG_GUESS) ||
      passLane !== null ||
      (c as any)._type === EFFECT_RENDER ||
      c._config & CONFIG_CHILDREN_FORBIDDEN ||
      (el as any)._host?.fam?.node === c
    )
      return NOT_PENDING;
    const l = txOf(el);
    joinPassAt(c, resolveTx(l._parent ?? l));
  }
  if (el._pendingValue !== NOT_PENDING) return el._pendingValue;
  return el._config & CONFIG_SLOT_NODE ? GlobalQueue._slotCovered!(el) : el._value;
}

function sameRow(a: unknown, b: unknown, keyFn: (item: any) => any): boolean {
  if (a === b) return true;
  if (!isWrappable(a) || !isWrappable(b)) return false;
  const ka = keyFn(unwrapValue(a));
  return ka !== undefined && sameKey(ka, keyFn(unwrapValue(b)));
}

/** A composed value becomes the lane's on `node`: a guess re-based, or a
 * node that was not the lane's becomes its derivation (its committed value
 * untouched beneath; the lane's end commits the latest). */
function laneSet(node: Signal<any>, value: unknown, lane: ReturnType<typeof txOf>): void {
  const x = ext(node);
  if (!(node._config & CONFIG_OVERRIDE)) {
    node._config |= CONFIG_OVERRIDE;
    list(node, lane);
  } else if (x._lane === value) return;
  x._lane = value;
  if (node._subs !== null) {
    insertSubs(node);
    laneDirty(node, lane);
  }
}

/** D-34 for a per-key guess (#4329): the derive's draft wrote new objects
 * over a target holding guessed rows (`d.length = 0; d.push(...rows)`, or
 * `d.issues = rows`). The container on the way down to each guessed row
 * reconciles the new object at its slot — in a keyed list, the one with
 * the row's key — exactly as a returned landing would: rows match by key,
 * a guessed row keeps its target, and its leaves are judged against their
 * guesses. Rows nothing guessed are left as the draft wrote them. */
function pairRows(t: StoreTarget, pb: Record<PropertyKey, any>): void {
  const keyFn = t.fam!.key;
  for (let c of t.fam!.overlaid ?? []) {
    // The guessed row, or its ancestor directly under `t` (none: skip).
    while (c.u !== t) if ((c = c.u!) === null) break;
    if (c === null) continue;
    const k = keyFn?.(c.v);
    const nv = Array.isArray(pb)
      ? k !== undefined && pb.find(r => isWrappable(r) && sameKey(keyFn!(r), k))
      : pb[c.pk!];
    // A new object only: not `c`'s own, nor one another row serves
    // (pairing it would alias the two).
    if (isWrappable(nv) && !lookupTarget(nv, t.fam)) reconcileState(nv, c.px, keyFn, true);
  }
}

installOptHooks({
  pair: pairRows,
  draft: optimisticDraft,
  writes: notifyOptimisticWrites,
  arrangement,
  reconcile: reconcileDraft,
  view: (t, src, writer = false) =>
    writer ? optimisticView(t, src, laneValueOf, true) : optimisticView(t, src),
  has: optimisticHas,
  descriptor: optimisticOwnDescriptor,
  sweep: sweepOverlaid,
  // A new question (not a `refresh()`) asked over guesses an earlier frame
  // opened, which answer the old one (D-34, #4336). Stamped on `fam.asked`
  // with this flush's `clock`, so it lapses when the flush ends: `clock + 1`
  // from mainline over a live guess — a frame still reading a guess at the
  // seam shows it beside the new input, so the flush holds with the guess's
  // action (`park`); `~clock` from a lane with no guess of its own, or with
  // no live guess left — the lane waits for its answer (F-6), as for a
  // guessed `createOptimistic` (lanes `laneStage`). The guess's own lane
  // asks nothing new and stamps nothing.
  ask: fam => {
    if (fam.node!._flags & REACTIVE_REASK || !fam.overlaid?.size) return;
    // Stamped with the flush (`clock`): it lapses when the flush ends.
    let a = ~clock;
    for (const g of fam.overlaid) {
      const n = laneNodeOf(g);
      if (n) {
        if (passLane === null) a = clock + 1;
        else if (sameAction(txOf(n), passLane)) return;
      }
    }
    if ((fam.asked = a) > 0) joinFuture(null);
  },
  // Over a new question the guesses do not answer (`asked`): from mainline
  // only a target carrying a guess stands in — a read of one with none is an
  // ordinary pending read (F-2), so a keyed store's other keys wait for their
  // answer, not for the guess's action; in a lane with no guess of its own,
  // or with no live guess left, none does (F-6).
  stands: t => {
    const o = t.fam!.overlaid;
    const a = t.fam!.asked;
    return !!o?.size && (a !== clock + 1 || passLane !== null || o.has(t)) && a !== ~clock;
  },
  // Mainline hold (`clock + 1`): the flush joins the action of each guess a
  // reader still reads at the seam; a reader that moved off it (a keyed
  // store's other key) holds nothing.
  park: t => {
    for (const fam of overlaidFamilies)
      if (fam.asked === clock + 1)
        for (const g of fam.overlaid!) {
          const n = laneNodeOf(g, true);
          if (n) merge(txOf(n)._parent!, t);
        }
  }
});

/** Two lanes of one action (their parents resolved through merges). */
function sameAction(a: Transaction, b: Transaction): boolean {
  return resolveTx(a._parent!) === resolveTx(b._parent!);
}

function shallowKeys(o: Record<PropertyKey, any>): Record<PropertyKey, any> {
  const out: Record<PropertyKey, any> = {};
  for (const k of Reflect.ownKeys(o)) if (k !== $OWNER) out[k as any] = unwrapValue(o[k as any]);
  return out;
}

/** Families with a target carrying a lane value — swept at the flush's
 * commit (`sweepOverlaid`): a target none of whose nodes is a lane's any
 * more leaves its family's `overlaid`. (Not on the read path: a guess is
 * pending between the setter and the seam, and a read in between must not
 * take the target for clean.) */
const overlaidFamilies: Set<StoreFamily> = new Set();

function markOverlaid(t: StoreTarget): void {
  const fam = t.fam!;
  (fam.overlaid ??= new Set()).add(t);
  overlaidFamilies.add(fam);
}

export function sweepOverlaid(): void {
  if (overlaidFamilies.size === 0) return;
  for (const fam of overlaidFamilies) {
    const set = fam.overlaid!;
    for (const t of set)
      if (!laneNodeOf(t)) {
        set.delete(t);
        if (t.ch) rebaseChained(t);
        // The container shows its backing again (a shown arrangement guess
        // that ended without a landing left its `LaneView` as the value).
        const k = t.k;
        if (k !== null && k._value instanceof LaneView) k._value = k._value.base;
      }
    if (set.size === 0) overlaidFamilies.delete(fam);
  }
}

/** A chained view's lanes ended: its nodes are links (§7b) whose committed
 * value is the inner store's at the guess, not now — the inner may have
 * moved underneath the guess (the base committed while the view showed
 * its arrangement, #3672/F1). Re-base each node on the inner's truth and
 * re-derive the readers whose shown value it is not. */
function rebaseChained(t: StoreTarget): void {
  const inner = t.v as Record<PropertyKey, any>;
  let changed = false;
  const nodes = t.n;
  if (nodes !== null)
    for (const key of Reflect.ownKeys(nodes)) {
      const node = nodes[key as any];
      const cur = untrack(() => unwrapValue(inner[key as any]));
      if (node._equals && node._equals(node._value, cur)) continue;
      node._value = cur;
      // (The lane's end notified it this epoch when the shown value and the
      // covered one differed — its readers re-derive already.)
      if (node._subs !== null && node._notifiedAt !== notifyEpoch) {
        insertSubs(node);
        changed = true;
      }
    }
  const has = t.h;
  if (has !== null)
    for (const key of Reflect.ownKeys(has)) {
      const node = has[key as any];
      const cur = untrack(() => key in inner);
      if (node._value === cur) continue;
      node._value = cur;
      if (node._subs !== null && node._notifiedAt !== notifyEpoch) {
        insertSubs(node);
        changed = true;
      }
    }
  // The arrangement the readers saw (the shown guess) against the inner's
  // now: a structural reader re-derives when they differ.
  const k = t.k;
  if (
    k !== null &&
    k._subs !== null &&
    k._value instanceof LaneView &&
    k._notifiedAt !== notifyEpoch
  ) {
    const rows = Array.isArray(inner) ? untrack(() => (inner as any[]).map(unwrapValue)) : inner;
    if (!arrangementEqual(k._value.rows, rows, t.fam?.key ?? null)) {
      insertSubs(k);
      changed = true;
    }
  }
  if (changed) schedule();
}

/** `t`'s nodes (a missing container or deep node: null). */
function nodesOf(t: StoreTarget): any[] {
  const all = [t.k, t.dk];
  for (const r of [t.n, t.h])
    if (r !== null) for (const k of Reflect.ownKeys(r)) all.push(r[k as any]);
  return all;
}
/** A node of `t` carrying a lane value, if any (`read`: one a reader's
 * last pass read). */
function laneNodeOf(t: StoreTarget, read?: boolean): Signal<any> | undefined {
  for (const n of nodesOf(t))
    if (n?._config & CONFIG_OVERRIDE) {
      if (!read) return n;
      for (let s = n._subs; s !== null; s = s._nextSub) if (s._gen === s._sub._depGen) return n;
    }
}

function overlaid(t: StoreTarget): boolean {
  const fam = t.fam;
  return fam !== null && fam.opt === true && fam.overlaid !== undefined && fam.overlaid.has(t);
}

/** What a lane node shows an untracked reader here: core's rule (`read`
 * without a link — the lane's world inside its own pass, the screen
 * outside, a verdict window's answer under one). */
const shown = (n: Signal<any>): unknown => untrack(() => readNode(n));

/** An untracked `key in store` on an optimistic family: the presence guess
 * (what its lane shows) when the key carries one; `undefined` when not —
 * the backing answers. */
export function optimisticHas(t: StoreTarget, key: PropertyKey): boolean | undefined {
  if (!overlaid(t)) return undefined;
  const h = t.h?.[key as any];
  if (h !== undefined && h._config & CONFIG_OVERRIDE) return !!shown(h);
  const n = t.n?.[key as any];
  if (n !== undefined && n._config & CONFIG_OVERRIDE) return shown(n) !== undefined;
  return undefined;
}

/** A descriptor read of a guessed key: synthesized from the lane's value
 * (`null`: the guess removed the key; `undefined`: no guess — the backing
 * describes it). */
export function optimisticOwnDescriptor(
  t: StoreTarget,
  key: PropertyKey
): PropertyDescriptor | null | undefined {
  const present = optimisticHas(t, key);
  if (present === undefined) return undefined;
  if (!present) return null;
  const n = t.n?.[key as any];
  const value = n !== undefined && n._config & CONFIG_OVERRIDE ? shown(n) : t.v[key as any];
  // An array's `length` is reported as the array has it (non-configurable).
  if (key === "length" && Array.isArray(t.v))
    return { value, writable: true, enumerable: false, configurable: false };
  return { value, writable: true, enumerable: true, configurable: true };
}

/** The truth `src` with the target's lane values over it: each overlaid
 * leaf's value (`pick`: what the lane shows, or — for `latest` — the lane's
 * latest), each presence guess as a key added or removed, the array
 * length. Returns `src` itself when nothing is overlaid. */
export function optimisticView(
  t: StoreTarget,
  src: Record<PropertyKey, any>,
  pick: (n: any) => unknown = shown,
  // The writer's view: the unflushed guesses too (on nodes that are no
  // lane's yet) — what the next write composes on (#3665).
  writer = false
): Record<PropertyKey, any> {
  if (!writer && !overlaid(t)) return src;
  let out: Record<PropertyKey, any> | null = null;
  const ensure = () => (out ??= Array.isArray(src) ? [...(src as any[])] : { ...src });
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) {
      const node = nodes[key as any];
      let ov: unknown;
      if (node._config & CONFIG_OVERRIDE) ov = pick(node);
      else if (!writer || (ov = pendingGuessOf(node)) === NOT_PENDING) continue;
      if (key === "length" && Array.isArray(src)) {
        if ((src as any[]).length !== ov) (ensure() as any[]).length = ov as number;
      } else if (!isEqual(src[key as any], ov) || !hasOwn.call(src, key)) {
        ensure()[key as any] = ov;
      }
    }
  }
  const has = t.h;
  if (has !== null) {
    for (const key of Reflect.ownKeys(has)) {
      const node = has[key as any];
      let pv: unknown;
      if (node._config & CONFIG_OVERRIDE) pv = pick(node);
      else if (!writer || (pv = pendingGuessOf(node)) === NOT_PENDING) continue;
      const present = !!pv;
      const view = out ?? src;
      if (!present && key in view) delete ensure()[key as any];
    }
  }
  return out ?? src;
}

/** `latest()`'s view: the lanes' latest values (a landing staged beneath a
 * guess is what lands). */
export function latestView(
  t: StoreTarget,
  src: Record<PropertyKey, any>
): Record<PropertyKey, any> {
  return optimisticView(t, src, laneValueOf);
}

export function createOptimisticStore<T extends object = {}>(
  initialValue: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null,
  options?: Omit<ProjectionOptions, "seedLoadingValue">
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>> | StoreOptions | null,
  third?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function";
  const options = (derived ? third : second) as ProjectionOptions | undefined;
  // Seedless derived form: the root starts as an empty record (see
  // createProjectionInternal).
  const initialValue = (derived ? second || {} : first) as T;
  const keyOption = options?.key === undefined ? "id" : options.key;
  const fam: StoreFamily = {
    map: new WeakMap(),
    node: null,
    live: new Set(),
    shallow: !!options?.shallow,
    opt: true,
    key:
      typeof keyOption === "function"
        ? keyOption
        : keyOption === null
          ? null
          : (row: any) => (isWrappable(row) ? row[keyOption] : undefined)
  };
  const store = wrap(initialValue as any, null, null, fam) as Store<T>;
  if (__OBSERVE__) nameStore(store, options?.name, options?.loc);
  if (fam.shallow) {
    ((store as any)[$TARGET] as StoreTarget).s = true;
    markRawIngest(initialValue);
  }
  if (derived) {
    const fn = first as (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>;
    let nodeOptions: { name?: string; loc?: string; loadingValue?: void } | undefined;
    if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
    if (__OBSERVE__ && (options?.name || options?.loc))
      nodeOptions = { ...nodeOptions, name: options.name, loc: options.loc };
    const node = computed(() => {
      if (!fam.node) fam.node = getOwner() as Computed<any>;
      runProjectionComputed(store, fn, keyOption);
    }, nodeOptions) as Computed<void>;
    node._config &= ~CONFIG_AUTO_DISPOSE;
    fam.node = node;
  }
  return [store, ((fn: (draft: T) => void) => storeSetter(store, fn)) as StoreSetter<T>];
}
