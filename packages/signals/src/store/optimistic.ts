/**
 * Store — optimistic stores on lanes (plan §31, S4; INTERNALS §3/§7, RUL-3).
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
 * Landings (Q-D, §31.7): the derive's output is reconciled against the
 * optimistic VIEW — a row the guess added and the server returns with the
 * same key in the same position keeps its proxy (the row target adopts the
 * server object), its leaves write truth beneath their guesses, and the
 * container's arrangement guess is confirmed silently (`LaneView`'s
 * comparator) — `For` does not run. Retained-setter replay (the
 * 2026-08-31b continuation half) is not built here; the matrix decides.
 */
import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_OVERRIDE,
  NOT_PENDING,
  STATUS_PENDING
} from "../core/constants.js";
import { computed, isEqual, read as readNode, untrack } from "../core/core.js";
import { laneValueOf, optimisticWrite, pendingGuessOf } from "../core/lanes.js";
import { getOwner } from "../core/owner.js";
import { GlobalQueue, insertSubs, notifyEpoch, schedule } from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { Refreshable } from "../core/index.js";
import { runProjectionComputed } from "./projection.js";
import {
  cloneRaw,
  committed,
  getContainerNode,
  getHasNode,
  getNode,
  installOptHooks,
  LaneView,
  nameStore,
  sameKey,
  storeSetter,
  targetsEqual,
  unwrapValue,
  wrap
} from "./store.js";
import { $OWNER, type StoreFamily, type StoreTarget } from "./target.js";
import {
  $TARGET,
  isWrappable,
  markRawIngest,
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

/** The user's draft on an optimistic family: a clone of the view the user
 * saw — the committed frame with the lanes' values and the tick's own
 * unflushed guesses over it (#3665). A staging already on the target (a
 * landing adopted this flush) is set aside for the setter's duration: the
 * guesses go over it, it stays the truth beneath. */
function optimisticDraft(t: StoreTarget): Record<PropertyKey, any> {
  if (t.pb !== null) optStaged.set(t, t.pb);
  return cloneRaw(optimisticView(t, committed(t), laneValueOf, true), t);
}

export function notifyOptimisticWrites(
  t: StoreTarget,
  pb: Record<PropertyKey, any>
): Record<PropertyKey, any> | null {
  // The view the user saw: the committed frame (a staging adopted eagerly
  // is not it) with the lanes' values and the tick's own guesses over it.
  const base = committed(t);
  const old = optimisticView(t, base, laneValueOf, true);
  const isArr = Array.isArray(pb);
  // A chained target's nodes are links (§7b): their committed value is
  // never served and never learns the inner store's commits — yet a guess
  // is judged against it, and reverts to it (#3672). Hand the node the
  // inner store's truth for its key before guessing over it.
  const inner = t.ch ? (t.v as Record<PropertyKey, any>) : null;
  const guess = (node: Signal<any>, key: PropertyKey, presence: boolean, nv: unknown): void => {
    if (inner !== null)
      node._value = untrack(() => (presence ? key in inner : unwrapValue(inner[key as any])));
    // By value: a function leaf is a value, not an updater (#3017).
    optimisticWrite(node, () => nv);
  };
  let structural = false;
  for (const key of Reflect.ownKeys(pb)) {
    if ((isArr && key === "length") || key === $OWNER) continue;
    const nv = unwrapValue(pb[key as any]);
    if (!(key in old)) {
      guess(getNode(t, key), key, false, nv);
      guess(getHasNode(t, key), key, true, true);
      structural = true;
    } else {
      const ov = unwrapValue(old[key as any]);
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
    optimisticWrite(getContainerNode(t), new LaneView(rows, base) as any);
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
  return ka !== undefined && sameKey(ka, kb);
}

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

installOptHooks({
  draft: optimisticDraft,
  writes: notifyOptimisticWrites,
  arrangement,
  reconcile: reconcileDraft,
  view: (t, src, writer = false) =>
    writer ? optimisticView(t, src, laneValueOf, true) : optimisticView(t, src),
  has: optimisticHas,
  descriptor: optimisticOwnDescriptor,
  sweep: sweepOverlaid
});

/** Lanes ask: is a slot node's truth in flight? Its family's derive is
 * (A17, #2864: a guess mid-refetch stands in for the flight — shown until
 * the landing confirms or corrects it, never dropped as a no-frame write). */
GlobalQueue._slotFlight = (n: Signal<any>): boolean => {
  const fam = ((n as any)._host as StoreTarget | undefined)?.fam;
  return fam != null && fam.node !== null && (fam.node._statusFlags & STATUS_PENDING) !== 0;
};

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
      if (!carriesLane(t)) {
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

function carriesLane(t: StoreTarget): boolean {
  if (t.k !== null && t.k._config & CONFIG_OVERRIDE) return true;
  if (t.dk !== null && t.dk._config & CONFIG_OVERRIDE) return true;
  const nodes = t.n;
  if (nodes !== null)
    for (const key of Reflect.ownKeys(nodes))
      if (nodes[key as any]._config & CONFIG_OVERRIDE) return true;
  const has = t.h;
  if (has !== null)
    for (const key of Reflect.ownKeys(has))
      if (has[key as any]._config & CONFIG_OVERRIDE) return true;
  return false;
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
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: Partial<T> | NoFn<T> | Store<NoFn<T>> | StoreOptions,
  third?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function";
  const options = (derived ? third : second) as ProjectionOptions | undefined;
  const initialValue = (derived ? second : first) as T;
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
  if (__OBSERVE__) nameStore(store, options?.name);
  if (fam.shallow) {
    ((store as any)[$TARGET] as StoreTarget).s = true;
    markRawIngest(initialValue);
  }
  if (derived) {
    const fn = first as (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>;
    let nodeOptions: { name?: string; loadingValue?: void } | undefined;
    if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
    if (__OBSERVE__ && options?.name) nodeOptions = { ...nodeOptions, name: options.name };
    const node = computed(() => {
      if (!fam.node) fam.node = getOwner() as Computed<any>;
      runProjectionComputed(store, fn, keyOption);
    }, nodeOptions) as Computed<void>;
    node._config &= ~CONFIG_AUTO_DISPOSE;
    fam.node = node;
  }
  return [store, ((fn: (draft: T) => void) => storeSetter(store, fn)) as StoreSetter<T>];
}
