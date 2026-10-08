/**
 * Store — plain stores on L2 (plan sec. 31, S1).
 *
 * A store is a tree of L2 nodes and nothing else carries reactive state:
 *
 * - **Leaf nodes** (one per tracked-or-written key, lazy; `slotSignal`, one
 *   literal): `_value` committed, `_pendingValue` this batch's staging.
 * - **Presence nodes** (`in` tracks presence, not value — R13) and the
 *   **deep witness** (`deep()` subscribes one node per record).
 * - The **container node** `k` (plan sec. 31.3, Q-A): the `$TRACK` node given a
 *   value. `_value` is the committed backing, `_pendingValue` the pending
 *   backing the draft mutates — so a write to a key nobody reads has a
 *   staging home the scheduler owns, and park/commit/revert of the backing
 *   is the hold model's, not a fold ledger of the store's. Structural
 *   readers (`ownKeys`, iteration, `$TRACK`, `length`, `deep`) subscribe to
 *   it; value readers never do — a key with no leaf reads through the
 *   container's visible backing without subscribing (R1: node existence is
 *   unobservable).
 *
 * The committed backing (`t.v`) is owned raw (CoW: a user object is shared
 * until the first write privatizes it and its ancestor chain). It mutates at
 * exactly one moment — the flush's commit (`_storeCommit`), after the
 * container node committed its staging. Reads: context-free readers see the
 * committed backing until the flush; a pass sees the staging (signal
 * parity, RUL-1); the draft reads its own staging.
 *
 * Perf contracts (plan sec. 31.4): lazy nodes; one literal per node; O(written) per
 * setter (`wk`); overlay drafts for large plain records; no new named
 * fields on array targets; zero allocation for adopted-but-unread objects.
 */
import { attrHooks } from "../core/attribution-hooks.js";
import {
  $REFRESH,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_HELD,
  CONFIG_MANUAL_WRITE,
  CONFIG_OVERRIDE,
  CONFIG_PROMOTED,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_STAGED_READ,
  STATUS_ERROR,
  STATUS_PENDING
} from "../core/constants.js";
import {
  context,
  isEqual,
  notePromotedWrite,
  ownedScopeWriteMessage,
  read as readNode,
  REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
  setSignal,
  slotSignal,
  stagedRead,
  stagedScreen,
  strictRead,
  untrack,
  untrackDepth,
  verdict
} from "../core/core.js";
import {
  asyncTailFlights,
  checkPostAwaitRead,
  DEV,
  emitDiagnostic,
  registerGraph,
  warnStrictReadUntracked
} from "../core/dev.js";
import { setSlotUnobserved } from "../core/graph.js";
import { getObserver, getOwner } from "../core/owner.js";
import { insertIntoHeap } from "../core/heap.js";
import {
  dirtyQueue,
  flushTransaction,
  GlobalQueue,
  globalQueue,
  holdNode,
  insertSubs,
  joinFuture,
  joinPassTx,
  passLane,
  queuePendingNode,
  schedule,
  txOf,
  type Transaction
} from "../core/scheduler.js";
import type { Computed, Owner, Signal } from "../core/types.js";
import {
  $OWNER,
  devAssertNeverUserMutation,
  ingestedRaw,
  isOwned,
  lookupTarget,
  markDescendants,
  setLookup,
  storeLookup,
  storeOwners,
  type StoreFamily,
  type StoreTarget
} from "./target.js";
/** The optimistic machinery (optimistic.ts, S4), installed when it loads
 * — a plain store pays nothing for it (#2883): the plain paths reach it
 * only through a family with `opt` set, which only `createOptimisticStore`
 * sets. */
export interface OptHooks {
  /** A user setter's draft on an optimistic family: a clone of the
   * writer's view (a staging already on the target is set aside). */
  draft(t: StoreTarget): Record<PropertyKey, any>;
  /** The setter's exit: the draft becomes guesses; returns the staging the
   * draft set aside (`null`: none). */
  writes(t: StoreTarget, pb: Record<PropertyKey, any>): Record<PropertyKey, any> | null;
  /** `src` with the lanes' values over it (`writer`: the next write's base
   * — the unflushed guesses too). */
  view(t: StoreTarget, src: Record<PropertyKey, any>, writer?: boolean): Record<PropertyKey, any>;
  /** An untracked `key in store`: the presence guess, or `undefined`. */
  has(t: StoreTarget, key: PropertyKey): boolean | undefined;
  /** A guessed key's descriptor (`null`: removed; `undefined`: no guess). */
  descriptor(t: StoreTarget, key: PropertyKey): PropertyDescriptor | null | undefined;
  /** The flush's commit: targets no lane holds leave `overlaid`. */
  sweep(): void;
  /** The container comparator's lane arm: an arrangement guess against a
   * landing (or another arrangement), by row identity. */
  arrangement(t: StoreTarget, a: any, b: any): boolean;
  /** A user's `reconcile` on an optimistic family: the keyed diff written
   * into the draft. */
  reconcile(draft: any, incoming: any, keyFn: ((item: any) => any) | null): void;
}
export let optHooks: OptHooks | null = null;
export function installOptHooks(hooks: OptHooks): void {
  optHooks = hooks;
}

/** The store half of `affects()` (store/affects.ts), installed by the first
 * store-targeted declaration: a node born on a covered record inherits the
 * live mark; an untracked verdict probe through a record with no node is
 * witnessed. */
export interface AffectsHooks {
  born(t: StoreTarget, node: Signal<any>, key: PropertyKey): void;
  witness(t: StoreTarget, key: PropertyKey | undefined): void;
}
export let affectsHooks: AffectsHooks | null = null;
export function installAffectsHooks(hooks: AffectsHooks): void {
  affectsHooks = hooks;
}
import {
  $PROXY,
  $RECORD,
  $TARGET,
  $TRACK,
  writeOverride,
  isRawValue,
  isWrappable,
  markRawIngest,
  markRawOne,
  rawValuesUsed,
  type StoreOptions
} from "./types.js";

export { $PROXY, $TARGET, $TRACK, markRaw } from "./types.js";

export type SetStoreFunction<T> = (fn: (draft: T) => T | void) => void;

/** Key of the deep-witness slot node (never a user key). */
const $DEEP: unique symbol = Symbol(__DEV__ ? "STORE_DEEP" : 0);

// ---------------------------------------------------------------------------
// wrap / dedupe

/** Pre-shaped constructor for OBJECT proxy targets: V8 tips a bare `{}` into
 * dictionary mode once ~19 named properties are assigned onto it (the #3044
 * `ovl`/`del` fields crossed that line — every trap's field read became a
 * hash lookup, a 15% deep-dbmon tick regression). Declaring every field in a
 * constructor pre-allocates in-object slots so the map stays fast, with
 * headroom for future fields. The prototype is reset to `Object.prototype`
 * so proxy-forwarded semantics (getPrototypeOf, constructor) are exactly a
 * plain object's. Array targets keep the bare-`[]` path — they must carry
 * the array exotic class for `Array.isArray(proxy)`.
 *
 * ARRAY SHAPE RULE: arrays normalize their named properties to dictionary
 * mode as the count grows (V8 13.x: counts ≡ 0 mod 3 from 18 up), so the
 * target's named field count is capped at 20 — any future write-side state
 * beyond `wk` must ride an extension object (see target.ts), never new
 * named fields here. */
function TargetShape(this: any) {
  this.v = undefined;
  this.ch = undefined;
  this.pb = undefined;
  this.n = undefined;
  this.h = undefined;
  this.k = undefined;
  this.dk = undefined;
  this.u = undefined;
  this.pk = undefined;
  this.px = undefined;
  this.d = undefined;
  this.a = undefined;
  this.sc = undefined;
  this.kc = undefined;
  this.nc = undefined;
  this.fam = undefined;
  this.s = undefined;
  this.ovl = undefined;
  this.del = undefined;
  this.wk = undefined;
}
TargetShape.prototype = Object.prototype;

function createTarget(
  value: Record<PropertyKey, any>,
  parent: StoreTarget | null,
  parentKey: PropertyKey | null,
  fam: StoreFamily | null = parent?.fam ?? null
): StoreTarget {
  // The proxy target carries the array exotic class when the value is an
  // array, so Array.isArray(proxy) is true; the fields live on it directly.
  // Direct field assignment in one fixed order (no Object.assign literal
  // copy): every target shares a hidden-class transition chain — createTarget
  // was the #2 store cost in the uibench creation profile.
  const t: StoreTarget = (Array.isArray(value) ? [] : new (TargetShape as any)()) as any;
  t.v = value;
  // Chained-backing flag (backing IS another store's proxy, §7b) — cached so
  // the hot read path never does a per-read symbol lookup on the backing.
  t.ch = (value as any)[$TARGET] !== undefined;
  t.pb = null;
  t.n = null;
  t.h = null;
  t.k = null;
  t.dk = null;
  t.wk = null;
  t.u = parent;
  t.pk = parentKey;
  t.px = null;
  t.d = false;
  t.a = false;
  t.sc = 0;
  t.kc = 0;
  t.nc = 0;
  t.fam = fam;
  t.s = false;
  t.ovl = false;
  t.del = null;
  t.px = new Proxy(t, traps);
  setLookup(value, t);
  if (__TEST__ && ingestedRaw && !isOwned(value)) ingestedRaw.add(value);
  return t;
}

export function wrap<T extends Record<PropertyKey, any>>(
  value: T,
  parent: StoreTarget | null = null,
  parentKey: PropertyKey | null = null,
  fam: StoreFamily | null = parent?.fam ?? null
): T {
  // markRaw'd values never wrap through ANY store (R42; sticky raw-marking
  // is one half of the never-both-wrapped-and-raw invariant, RUL-12).
  if (rawValuesUsed && isRawValue(value)) return value;
  const existing = lookupTarget(value, fam);
  if (existing !== undefined) return existing.px;
  const t: StoreTarget | undefined = (value as any)[$TARGET];
  if (t !== undefined && t.px === value) {
    // Foreign-family proxies re-wrap into THIS family (writes stay isolated);
    // same-family and plain-store proxies pass through.
    if (fam === null || t.fam === fam) return value;
    return createTarget(value as any, parent, parentKey, fam).px;
  }
  return createTarget(value, parent, parentKey, fam).px;
}

/** Unwrap our own proxies to their current backing; leave everything else.
 * A projection draft wrapper is registered as its target's alias
 * (projection.ts `wrapDraft`) — adopted as a backing, it would forward to
 * itself (#3767). */
export function unwrapValue(v: any): any {
  if (v == null || typeof v !== "object") return v;
  const t: StoreTarget | undefined = v[$TARGET];
  if (t !== undefined && (t.px === v || lookupTarget(v, t.fam) === t) && t.v !== undefined) {
    // A draft escaping into other storage must be a REAL container that
    // becomes this target's committed backing at fold (the shared-raw
    // contract) — a prototype overlay is neither.
    if (t.ovl) materializePB(t);
    return t.pb ?? t.v;
  }
  return v;
}

// ---------------------------------------------------------------------------
// nodes: pure subscription points (values used only for equality gating)

// Shared slot-node equality (create-floor diet): ONE function for every
// leaf — `this` is the node (method-call convention at every _equals site),
// `_host` is the baked-in target backref. Logical-slot equality: values
// resolving to the same child target are the same slot (privatization/
// adoption swap raw identity without changing the logical value — only
// changed leaves notify, R9).
const slotNodeEquals = function (this: any, a: any, b: any): boolean {
  return isEqual(a, b) || sameLogicalSlot(this._host, a, b);
};
/** The deep witness: the store decides when it notifies. */
const never = false as unknown as (a: any, b: any) => boolean;

export function sameKey(a: any, b: any): boolean {
  return a === b || (a !== a && b !== b);
}

/** The container node's arrangement guess: the rows (or keys) the setter
 * left the container with, in order. Its comparator judges a landing or a
 * revert against it by row identity — by key when the family has one
 * (the server's object for a guessed row is the same row). */
export class LaneView {
  constructor(
    public rows: Record<PropertyKey, any>,
    /** The backing the guess is shown over: the committed one at the
     * guess, the composed arrangement after a re-base (optimistic.ts). */
    public base: Record<PropertyKey, any>,
    /** Keys the setter REMOVED from the view it saw (a deliberate delete,
     * not a row the truth has yet to show): a re-base does not restore
     * them. `null` when none. */
    public removed: Set<unknown> | null = null
  ) {}
}

/** A container node's value as a backing: the base an arrangement guess is
 * shown over, else the value itself. */
export function asBacking(v: any): Record<PropertyKey, any> {
  return v instanceof LaneView ? v.base : v;
}

/** The container node's comparator: a staging is a backing (identity — a
 * pending backing is never "equal" to the committed one); a lane value is
 * an arrangement (`LaneView`), judged by the optimistic machinery. */
export const containerEquals = function (this: any, a: any, b: any): boolean {
  return a === b || (optHooks !== null && optHooks.arrangement(this._host, a, b));
};

function sameLogicalSlot(target: StoreTarget, a: any, b: any): boolean {
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") return false;
  const at = lookupTarget(a, target.fam);
  return at !== undefined && at === lookupTarget(b, target.fam);
}

/** Slot nodes whose last subscriber left while they still held a staging:
 * released at the commit that resolves it (`drainFolds`). */
const deferredReleases = new Set<Signal<any>>();

function releaseSlot(node: any): void {
  const t: StoreTarget = node._host;
  const key: PropertyKey = node._key;
  if (key === $TRACK) {
    if (t.k === node) t.k = null;
  } else if (key === $DEEP) {
    if (t.dk === node) t.dk = null;
  } else if (t.n !== null && t.n[key as any] === node) {
    delete t.n[key as any];
    t.nc--;
  } else if (t.h !== null && t.h[key as any] === node) delete t.h[key as any];
  // The family's index keeps only targets that still carry a node.
  if (
    t.fam !== null &&
    t.nc === 0 &&
    t.k === null &&
    t.dk === null &&
    (t.h === null || Reflect.ownKeys(t.h).length === 0)
  )
    t.fam.live.delete(t);
}

/** A node was born on `target`: a family target enters the live index. */
function noteNode(target: StoreTarget, node: Signal<any>, key: PropertyKey): void {
  if (target.fam !== null) target.fam.live.add(target);
  markDescendants(target);
  if (affectsHooks !== null) affectsHooks.born(target, node, key);
}

// Shared slot-node release handler: registered once; the core sweep
// dispatches CONFIG_SLOT_NODE nodes here (graph.ts) instead of holding a
// per-node closure in a per-node NodeExtension. A dropped node is
// unreachable through the store — a fresh read makes a fresh node.
setSlotUnobserved((node: any): void => {
  // A staged write — or a lane's value (a guess, S4) — is state only the
  // node holds: defer the release to the commit that resolves it.
  if (node._pendingValue !== NOT_PENDING || node._config & CONFIG_OVERRIDE)
    deferredReleases.add(node);
  else releaseSlot(node);
});

/** A node born while its container has a staging is born from the two
 * frames (A29): committed from the committed backing, the staging from the
 * pending one — and held by the container's transaction when the container
 * is held (#3706: the unit of the hold is the key — a key the batch left
 * unchanged stages nothing and holds no one). */
function bornStaged(target: StoreTarget, node: Signal<any>, staged: any, key: PropertyKey): void {
  if (node._equals && node._equals(node._value, staged)) return;
  queuePendingNode(node);
  node._pendingValue = staged;
  const k = target.k;
  if (k === null) return; // a node-less staging holds nothing (`stageOn`)
  // Held by the container's transaction only for a key the HELD staging
  // changed — a mainline layer's change above it stages mainline. (A
  // container carrying a guess is a lane's: the flush's park decides.)
  if ((k._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD && heldKeyChanged(target, key))
    holdNode(node, txOf(k));
  // A28 (4): a batch written inside a creation-time pass is promoted — its
  // late-materialized leaf with it.
  if (k._config & CONFIG_PROMOTED) notePromotedWrite(node);
}

export function getNode(
  target: StoreTarget,
  key: PropertyKey,
  // First-read dedupe (create-floor slice 2): the get trap probes
  // accessor-ness right before creating the node — pass the verdict through
  // so creation skips the second descriptor scan. -1 = unknown (other
  // callers), 0/1 = probed.
  accKnown: -1 | 0 | 1 = -1
): Signal<any> {
  const nodes = (target.n ??= Object.create(null));
  let node: Signal<any> | undefined = nodes[key];
  if (node === undefined) {
    // Accessor-ness resolved ONCE per node (no per-object descriptor scan
    // on reads): accessor keys serve through Reflect.get with the proxy
    // receiver.
    const pb = target.pb;
    const created: Signal<any> = (node = slotSignal(
      committed(target)[key as any],
      slotNodeEquals,
      target,
      key,
      accKnown === -1 ? isOwnAccessor(pb ?? target.v, key) : accKnown === 1
    ));
    if (pb !== null && !(created as any).acc)
      bornStaged(
        target,
        created,
        target.del !== null && target.del.has(key) ? undefined : pb[key as any],
        key
      );
    // Attribution-only: name store property nodes by path segment so
    // attribution chains and wide-scope warnings read "store.todos" (or
    // "todos.title" when the store was declared with a name), not
    // "signal". Gated on the engine being installed — node creation is
    // the hottest store path, and the disabled cost must stay one null
    // check (nodes created before enable() stay generically named).
    if (__OBSERVE__ && attrHooks !== null) {
      (created as any)._name = storeLabel(target) + "." + String(key);
      stampNodeOwner(created, target);
    }
    nodes[key] = node;
    target.nc++;
    noteNode(target, created, key);
  }
  return node;
}

export function getHasNode(target: StoreTarget, key: PropertyKey): Signal<boolean> {
  const nodes = (target.h ??= Object.create(null));
  let node: Signal<boolean> | undefined = nodes[key];
  if (node === undefined) {
    const created = (node = slotSignal(key in committed(target), isEqual, target, key, false));
    const pb = target.pb;
    if (pb !== null)
      bornStaged(target, created, key in pb && !(target.del !== null && target.del.has(key)), key);
    if (__OBSERVE__ && attrHooks !== null) stampNodeOwner(created, target);
    nodes[key] = node;
    noteNode(target, created, key);
  }
  return node;
}

/** The container node (plan sec. 31.3): created by the first structural subscription
 * or the first write that needs to stage. Its committed value is the
 * committed backing. */
export function getContainerNode(target: StoreTarget): Signal<any> {
  let k = target.k;
  if (k === null) {
    k = target.k = slotSignal(target.v, containerEquals, target, $TRACK, false);
    if (__OBSERVE__ && attrHooks !== null) stampNodeOwner(k, target);
    noteNode(target, k, $TRACK);
    // Born while a batch is staged without a node (`stageOn`): the node
    // takes the staging as its own — the pre-batch backing committed, the
    // pending backing staged — so whoever asked for it reads the frame it
    // would have read had the node been there from the write.
    if (target.pb !== null && !directCommit) {
      k._value = preBatch(target);
      k._pendingValue = target.pb;
      queuePendingNode(k);
    }
  }
  return k;
}

/** Q-A's escape hatch (plan sec. 33; measured plan sec. 41.4): a staging needs the container
 * node as its home only when something can read the frame through it — a
 * structural subscriber (the node exists), lane work (the staging is the
 * lane's), a pass outside a flush (its write is promoted at the pass's end,
 * A28 (4)), or a derive a transaction holds (the staging is the derive's,
 * `holdWithDerive`). Otherwise the backing and the fold queue are the whole
 * staging: nothing allocates, nothing is swept at the commit (dbmon's tick
 * re-created, queued, swept and dropped ~7000 container nodes). If the
 * flush parks, the seam materializes and holds the node then
 * (`_storePark`) — the one case the staging home exists for. */
function stageOn(target: StoreTarget, pb: Record<PropertyKey, any>): void {
  if (
    target.k === null &&
    passLane === null &&
    (context === null || globalQueue._running) &&
    !deriveHolds(target)
  )
    return;
  const k = getContainerNode(target);
  if (k._pendingValue === NOT_PENDING) queuePendingNode(k);
  k._pendingValue = pb;
  // A28 (4): a write issued inside a pass outside a flush (a creation-time
  // derive) is promoted at the pass's end — the batch with it.
  if (context !== null) notePromotedWrite(k);
  if (target.fam !== null) holdWithDerive(target, k);
}

/** The projection's derive is held by a transaction and this is its own
 * write (not a user setter's): the staging is the derive's (`holdWithDerive`). */
function deriveHolds(target: StoreTarget): boolean {
  const fw = target.fam?.node;
  return fw != null && !userWrite && (fw._config & CONFIG_HELD) !== 0;
}

GlobalQueue._storePark = t => {
  for (let i = 0; i < foldList.length; i++) {
    const target = foldList[i];
    if (target.k === null && target.pb !== null) holdNode(getContainerNode(target), t);
  }
};

function getDeepNode(target: StoreTarget): Signal<number> {
  let dk = target.dk;
  if (dk === null) {
    dk = target.dk = slotSignal<number>(0, never, target, $DEEP, false);
    if (__OBSERVE__ && attrHooks !== null) stampNodeOwner(dk, target);
    noteNode(target, dk, $DEEP);
  }
  return dk;
}

export function bumpDeep(t: StoreTarget): void {
  if (t.dk !== null) setSignal(t.dk, 1 as any);
}

/** The structural readers' one notification: a membership/arrangement
 * change on the container (the staging is already on the node; `setSignal`
 * re-stages the same backing and walks the subscribers — and, on later
 * steps, routes a held or lane-owned container the way any node is). */
function notifyContainer(k: Signal<any>, pb: Record<PropertyKey, any>): void {
  // A container carrying an arrangement guess takes the write as a landing
  // on the guess (`laneWrite` → `supersede`, judged by `containerEquals`);
  // otherwise the structural readers are walked (the staging is already on
  // the node; the comparator is the store's, done).
  if (k._config & CONFIG_OVERRIDE) setSignal(k, pb);
  else {
    if (k._config & CONFIG_HELD) joinFuture(txOf(k));
    insertSubs(k);
    schedule();
  }
}

// Observe-tier labels and owners (attribution).
function storeRoot(target: StoreTarget): StoreTarget {
  let root = target;
  while (root.u !== null) root = root.u;
  return root;
}
function storeRootOwner(target: StoreTarget): Owner | null | undefined {
  return storeOwners!.get(storeRoot(target));
}
function stampNodeOwner(created: Signal<any>, target: StoreTarget): void {
  (created as any)._owner = storeRootOwner(target) ?? null;
}
const storeNames: WeakMap<StoreTarget, string> | null = __OBSERVE__ ? new WeakMap() : null;
export function nameStore(proxy: any, name: string | undefined): void {
  if (__OBSERVE__ && attrHooks !== null && name)
    storeNames!.set((proxy as any)[$TARGET] as StoreTarget, name);
}
function storeLabel(target: StoreTarget): string {
  return storeNames!.get(storeRoot(target)) ?? "store";
}

// ---------------------------------------------------------------------------
// clones (CoW privatization)

const hasOwn = Object.prototype.hasOwnProperty;
const lookupGetter = (Object.prototype as any).__lookupGetter__;
const lookupSetter = (Object.prototype as any).__lookupSetter__;
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;

function isOwnAccessor(src: Record<PropertyKey, any>, key: PropertyKey): boolean {
  return (
    hasOwn.call(src, key) &&
    (lookupGetter.call(src, key) !== undefined || lookupSetter.call(src, key) !== undefined)
  );
}

/** Shallow clone into store ownership. Plain data (grade 2) spreads; anything
 * else copies descriptors (accessors kept, everything made configurable). */
export function cloneRaw(
  source: Record<PropertyKey, any>,
  t: StoreTarget
): Record<PropertyKey, any> {
  t.sc || scanAccessorsOnce(t);
  if (t.sc === 2) {
    const clone = { ...source };
    (clone as any)[$OWNER] = t;
    return clone;
  }
  const descs = Object.getOwnPropertyDescriptors(source);
  for (const key of Reflect.ownKeys(descs)) {
    const d = (descs as any)[key];
    if (key === "length" && Array.isArray(source)) continue;
    d.configurable = true;
    if (!d.get && !d.set) d.writable = true;
    else t.a = true;
  }
  const clone = Array.isArray(source)
    ? (Object.defineProperties([], descs) as any)
    : Object.create(Object.getPrototypeOf(source), descs);
  clone[$OWNER] = t;
  return clone;
}

/** Wide plain clone (many keys): null-prototype build, then reset. */
function wideClone(source: Record<PropertyKey, any>, t: StoreTarget): Record<PropertyKey, any> {
  const clone = Object.create(null);
  for (const key of Reflect.ownKeys(source)) clone[key] = source[key as any];
  Object.setPrototypeOf(clone, Object.prototype);
  clone[$OWNER] = t;
  return clone;
}

function copyOwn(to: object, from: object, key: PropertyKey): void {
  const d = Object.getOwnPropertyDescriptor(from, key)!;
  if (d.get || d.set || !d.enumerable || !d.writable || !d.configurable)
    Object.defineProperty(to, key, d);
  else (to as any)[key] = d.value;
}

/** One descriptor scan per container (grade 1/2, `a`, `kc`). */
function scanAccessorsOnce(target: StoreTarget): boolean {
  const src = target.v;
  const keys = Reflect.ownKeys(src);
  let plain = Object.getPrototypeOf(src) === Object.prototype;
  for (const key of keys) {
    if (lookupGetter.call(src, key) !== undefined || lookupSetter.call(src, key) !== undefined) {
      target.a = true;
      plain = false;
      break;
    }
    if (plain && !propertyIsEnumerable.call(src, key)) plain = false;
  }
  target.sc = plain ? 2 : 1;
  target.kc = keys.length;
  return !target.a;
}

// ---------------------------------------------------------------------------
// the pending backing

const OVERLAY_MIN_KEYS = 32;
const OVERLAY_REBUILD_MAX_KEYS = 1024;
const OVERLAY_REBUILD_MIN_ADDS = 16;
const WK_ALL: Set<PropertyKey> = new Set();

const plainProto = (o: object): boolean => {
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === Array.prototype || p === null;
};

/** An overlay with many adds (or any delete) rebuilds the committed
 * container at flatten so its shape stays fast (#3689). */
function overlayRebuilds(t: StoreTarget, pb: Record<PropertyKey, any>): boolean {
  if (t.kc > OVERLAY_REBUILD_MAX_KEYS) return false;
  if (t.del !== null && t.del.size !== 0) return true;
  const wk = t.wk;
  if (wk !== null && wk !== WK_ALL && wk.size <= OVERLAY_REBUILD_MIN_ADDS) return false;
  const v = t.v;
  let adds = 0;
  for (const key of Reflect.ownKeys(pb))
    if (!hasOwn.call(v, key) && ++adds > OVERLAY_REBUILD_MIN_ADDS) return true;
  return false;
}

/** Downgrade an overlay to a real clone (a consumer needs a container). */
export function materializePB(target: StoreTarget): Record<PropertyKey, any> {
  const pb = target.pb!;
  if (!target.ovl) return pb;
  const clone = target.sc === 2 ? wideClone(target.v, target) : cloneRaw(target.v, target);
  if (target.del !== null) {
    for (const key of target.del) delete (clone as any)[key];
    target.kc -= target.del.size;
    target.del = null;
  }
  for (const key of Reflect.ownKeys(pb))
    target.sc === 2 ? ((clone as any)[key] = pb[key as any]) : copyOwn(clone, pb, key);
  target.pb = clone;
  target.ovl = false;
  // The staging IS the pending backing: re-point the container node.
  if (target.k !== null && target.k._pendingValue === pb) target.k._pendingValue = clone;
  return clone;
}

/** The batch's pending backing, created on the first draft write: an overlay
 * of an owned plain-data record above the key threshold, a clone otherwise.
 * Staged on the container node (the scheduler owns its lifetime) and queued
 * for the fold at the flush's commit. */
function ensurePB(target: StoreTarget): Record<PropertyKey, any> {
  let pb = target.pb;
  // An optimistic edit composes on the view the user saw and becomes
  // guesses at the setter's exit: nothing is staged, nothing folds
  // (optimistic.ts).
  if (userWrite && target.fam?.opt === true && !pendingNotify.has(target))
    return (target.pb = optHooks!.draft(target));
  if (pb !== null && !isOwned(pb)) {
    // An adopted object awaiting its fold is the user's: the draft writes a
    // clone of it. The clone is the batch's staging — unless the adoption is
    // HELD (another transaction's): then the held staging stays the
    // adoption and the draft is a mainline layer above it (#3612/#3688: a
    // mainline setter mid-hold publishes mainline; the held keys stay held).
    pb = target.pb = cloneRaw(pb, target);
    const k = target.k;
    if (k !== null && !(k._config & CONFIG_HELD)) k._pendingValue = pb;
  } else if (pb === null) {
    const v = target.v;
    if (!directCommit) queueFold(target);
    if (
      !target.ch &&
      !Array.isArray(v) &&
      (target.sc !== 0 ? !target.a : scanAccessorsOnce(target)) &&
      target.kc > OVERLAY_MIN_KEYS &&
      isOwned(v)
    ) {
      pb = target.pb = Object.create(v) as Record<PropertyKey, any>;
      target.ovl = true;
    } else pb = target.pb = cloneRaw(v, target);
    if (!directCommit) stageOn(target, pb);
  }
  return pb;
}

/** Privatize `target`'s committed backing (and its ancestor chain — a shared
 * parent cannot point at an owned child). Not a reactive event. */
function privatizeCommitted(target: StoreTarget): void {
  if (isOwned(target.v)) return;
  const before = target.v;
  const clone = cloneRaw(before, target);
  // Mid-batch (a staging is open on this target) the fold still sees the
  // backing the batch started from: the queue recorded it (`foldOlds`).
  target.v = clone;
  target.ch = false;
  if (target.u) {
    privatizeCommitted(target.u);
    devAssertNeverUserMutation(target.u.v);
    const pv = target.u.v;
    const slot = parentSlotKey(target, before);
    if (pv[slot] === before) pv[slot] = target.v;
  }
}

/** The key this target sits under in its parent — re-resolved by identity
 * when an array parent moved it (#3282). Not searched when the slot already
 * holds this target's backing (a parent adopted whole carries its children's
 * new raws before the children fold — the miss was O(rows) per changed row
 * of a keyed reconcile). */
function parentSlotKey(target: StoreTarget, expected: unknown): PropertyKey {
  const pk = target.pk!;
  const pv = target.u!.v;
  if (pv[pk] === expected || pv[pk] === target.v || !Array.isArray(pv)) return pk;
  const at = (pv as unknown[]).indexOf(expected);
  if (at === -1) return pk;
  target.pk = at;
  return at;
}

/** Overlay flatten (#3044): own keys onto the owned committed backing in
 * place — the backing keeps its identity. */
function flattenOverlay(t: StoreTarget, pb: Record<PropertyKey, any>): void {
  privatizeCommitted(t);
  const v = t.v;
  for (const key of Reflect.ownKeys(pb))
    t.sc === 2 ? ((v as any)[key] = pb[key as any]) : copyOwn(v, pb, key);
  if (t.del !== null) {
    for (const key of t.del) delete (v as any)[key];
    t.kc -= t.del.size;
    t.del = null;
  }
  t.pb = null;
  t.ovl = false;
  t.wk = null; // written-keys window closes with the commit
}

/** Adoption (a setter's returned replacement; reconcile and projection
 * landings in S3): the incoming object becomes the backing by reference at
 * the fold — no clones, no user-object mutation, ownership resets to
 * shared. It is the container's staging until then (signal parity: a
 * handler reads the committed frame until the flush; a hold keeps it
 * staged with the rest). The nodes are told now, diffed against the view
 * they were LAST told (#3296): the draft's pending backing when one
 * preceded the adoption this batch — its node writes were real, and the
 * adoption's re-stage cancels or confirms each — else the committed
 * backing. */
export function adoptPB(
  target: StoreTarget,
  incoming: Record<PropertyKey, any>,
  notify = true
): void {
  if (!directCommit) queueFold(target);
  let base: Record<PropertyKey, any>;
  if (target.pb !== null) {
    if (target.ovl) materializePB(target);
    base = target.pb!;
  } else base = target.v;
  if (directCommit) {
    target.pb = null;
    if (target.k !== null) target.k._value = incoming;
  } else {
    // Eager (INTERNALS §3): the backing swaps now — handlers read the
    // adopted object before the flush — while the container node, when
    // there is one (`stageOn`), keeps the committed frame (`_value`) for
    // readers a hold keeps on it, and stages the adoption for the fold's
    // path copy.
    target.pb = incoming;
    stageOn(target, incoming);
  }
  target.v = incoming;
  target.ch = (incoming as any)[$TARGET] !== undefined;
  target.ovl = false;
  target.del = null;
  target.sc = 0;
  target.a = false;
  target.wk = null; // adoption supersedes staged trap writes
  const owner: StoreTarget | undefined = (incoming as any)[$OWNER];
  if (owner !== undefined && owner.fam === target.fam) (incoming as any)[$OWNER] = target;
  else setLookup(incoming, target);
  if (__TEST__ && ingestedRaw && !isOwned(incoming)) ingestedRaw.add(incoming);
  if (notify && base !== incoming) notifyFold(target, base, incoming);
}

// ---------------------------------------------------------------------------
// the fold: owned raw's one mutation point, at the flush's commit

/** The fold queue: the targets with a batch open (`pb !== null` IS the
 * membership — a target is queued exactly while it carries a staging; the
 * drain skips one already folded), in two reusable arrays. Nothing here
 * allocates per batch once warm: a dbmon tick queues ~7000 containers, and
 * a map built and drained per tick cost ~540 KB of table allocation — most
 * of the tick's young-generation GC, and the whole of its gap to `next`
 * (plan sec. 41.5).
 *
 * Beside each target, its PRE-BATCH committed backing — `t.v` as the batch
 * opened on it (`foldOlds`, parallel to `foldList`). That one record is the
 * fold's base in every case: a draft's backing does not move until the fold
 * (so the record is `t.v` still), an adoption swaps it eagerly (the record
 * is the frame committed readers keep), a mid-batch privatization or a
 * draft over an adopted raw moves it again (the record is what the batch
 * started from, which is all the fold wants to know). The record lives
 * exactly as long as the batch: a weak map keyed by target kept every
 * container's LAST adopted-away backing alive until its next adoption —
 * for a keyed reconcile, the whole previous tree promoted out of the
 * nursery every tick (the saturated listened-paths shape ran 15–25% over
 * the fork, all of it this; plan sec. 43.2) — and for a store adopted
 * once, for its lifetime.
 *
 * The target carries no slot for its record (ARRAY SHAPE RULE, target.ts),
 * so a lookup by target (`preBatch`: a container node born onto an open
 * staging, a committed-frame read of a node-less staging, a park) indexes
 * the list through a map built on first use per batch — the drain itself
 * walks the two lists in step and never builds it. */
let foldList: StoreTarget[] = [];
let foldOlds: Record<PropertyKey, any>[] = [];
let foldSpare: StoreTarget[] = [];
let foldOldsSpare: Record<PropertyKey, any>[] = [];
let foldIndex: Map<StoreTarget, number> | null = null;

/** Before the staging is set and before an adoption swaps the backing. */
function queueFold(target: StoreTarget): void {
  if (target.pb !== null) return;
  schedule();
  if (foldIndex !== null) foldIndex.set(target, foldList.length);
  foldList.push(target);
  foldOlds.push(target.v);
}

/** The committed backing before this batch (valid while `pb !== null`). */
function preBatch(t: StoreTarget): Record<PropertyKey, any> {
  if (foldIndex === null) {
    foldIndex = new Map();
    for (let i = 0; i < foldList.length; i++) foldIndex.set(foldList[i], i);
  }
  const at = foldIndex.get(t);
  return at === undefined ? t.v : foldOlds[at];
}

/** The flush committed its pending nodes: fold every pending backing whose
 * container node committed (its staging is gone — `_value` is the backing
 * now) into the committed home; one a later step holds (its node still
 * staged) waits for the flush that commits it. Then the deferred slot
 * releases. */
function drainFolds(): void {
  if (foldList.length !== 0) {
    const list = foldList;
    const olds = foldOlds;
    foldList = foldSpare;
    foldOlds = foldOldsSpare;
    foldSpare = list;
    foldOldsSpare = olds;
    foldIndex = null;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.pb === null) continue; // folded already (a direct commit)
      const k = t.k;
      if (k !== null && k._pendingValue !== NOT_PENDING) {
        // held: commits with its hold
        foldList.push(t);
        foldOlds.push(olds[i]);
      } else foldTarget(t, olds[i]);
    }
    list.length = 0;
    olds.length = 0;
  }
  if (deferredReleases.size !== 0) {
    for (const node of deferredReleases) {
      if (
        node._pendingValue === NOT_PENDING &&
        !(node._config & CONFIG_OVERRIDE) &&
        node._subs === null
      ) {
        deferredReleases.delete(node);
        releaseSlot(node);
      }
    }
  }
}
/** Core asks: is a slot node's truth in flight? Its family's derive is —
 * lanes (A17, #2864: a guess mid-refetch stands in for the flight) and
 * marks (an ambient `affects()` over a declared reload lives to the
 * landing) read it. */
GlobalQueue._slotFlight = (n: Signal<any>): boolean => {
  const fam = ((n as any)._host as StoreTarget | undefined)?.fam;
  return fam != null && fam.node !== null && (fam.node._statusFlags & STATUS_PENDING) !== 0;
};
/** Core asks (lanes.ts `covered`): the value a slot node's guess covered.
 * A chained link's committed value is the inner store's at the last
 * read-through — refreshed here, since a guess served the reads since
 * (#3672: the revert compares against the base's live value). */
GlobalQueue._slotCovered = (n: Signal<any>): unknown => {
  const t = (n as any)._host as StoreTarget;
  if (t.ch) {
    const key = (n as any)._key as PropertyKey;
    const inner = t.v as Record<PropertyKey, any>;
    if (t.h !== null && t.h[key as any] === n) n._value = untrack(() => key in inner);
    else if (t.n !== null && t.n[key as any] === n)
      n._value = untrack(() => unwrapValue(inner[key as any]));
  }
  return n._value;
};
GlobalQueue._storeCommit = () => {
  drainFolds();
  optHooks?.sweep();
};

/** A projection's creation run commits directly (a memo's first value is
 * its `_value`, not a staging): the draft still writes a clone of the seed,
 * nothing is staged on the nodes, and the setter's exit folds the touched
 * containers at once. Only the synchronous first run. */
let directCommit = false;
export function runDirect(fn: () => void): void {
  const was = directCommit;
  directCommit = true;
  try {
    fn();
  } finally {
    directCommit = was;
  }
}

/** Fold one target's pending backing into its committed home. */
function foldTarget(t: StoreTarget, old: Record<PropertyKey, any>): void {
  {
    {
      const k = t.k;
      const pb = t.pb;
      if (pb !== null) {
        if (pb === t.v) {
          // An eager adoption nothing wrote after: the backing is already
          // the adopted object (shared ownership — never cloned).
          t.pb = null;
          t.wk = null;
        } else if (t.ovl && (t.v !== old || !overlayRebuilds(t, pb))) {
          // Overlay flatten (#3044): the backing keeps its identity, so the
          // `t.v === old` gate below skips path copying (the parent slot
          // already points here) and the adopted-notify (setter
          // notifications happened at write time). A backing privatized
          // mid-batch is a fresh clone the parent already points at.
          flattenOverlay(t, pb);
        } else if (t.v !== old) {
          // Privatized mid-batch (a child's path copy repointed us): the
          // owned backing takes the written keys.
          privatizeCommitted(t);
          const v = t.v;
          const wk = t.wk;
          if (wk !== null && wk !== WK_ALL) {
            for (const key of wk) {
              if (hasOwn.call(pb, key)) copyOwn(v, pb, key);
              else delete (v as any)[key];
            }
          } else {
            for (const key of Reflect.ownKeys(pb)) {
              const d = Object.getOwnPropertyDescriptor(pb, key)!;
              if (d.get || d.set || !d.enumerable || !d.writable || !d.configurable)
                Object.defineProperty(v, key, d);
              else if (d.value !== (old as any)[key] || !hasOwn.call(old, key))
                (v as any)[key] = d.value;
            }
            for (const key of Reflect.ownKeys(old)) {
              if (!hasOwn.call(pb, key)) delete (v as any)[key];
            }
          }
          t.pb = null;
          t.wk = null;
        } else {
          // The clone (or adopted object) becomes the committed backing
          // (path copy below).
          t.v = t.ovl ? materializePB(t) : pb;
          t.ch = (t.v as any)[$TARGET] !== undefined;
          t.pb = null;
          t.wk = null;
        }
      }
      if (k !== null) {
        // The node's committed value is the backing. A container nobody
        // subscribes to was a transient staging home (INTERNALS §5: an
        // observer-less write holds a transient record until the fold,
        // discarded with it) — gone with the batch.
        if (k._subs === null) t.k = null;
        else if (k._value instanceof LaneView) k._value.base = t.v;
        else k._value = t.v;
      }
      if (t.v !== old && t.u) {
        const slot = parentSlotKey(t, old);
        if (t.u.v[slot] === old) {
          privatizeCommitted(t.u);
          devAssertNeverUserMutation(t.u.v);
          t.u.v[slot] = t.v;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// write-time notification (setter exit)

/** Devtools and attribution: the containers a setter replaced wholesale. */
function storePathOf(t: StoreTarget): string {
  let path = "";
  for (let cur: StoreTarget | null = t; cur !== null; cur = cur.u)
    path = cur.pk === null ? "store" + path : "." + String(cur.pk) + path;
  return path;
}
const REPLACED_CENSUS_MAX = 64;
function sameLeaf(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return unwrapValue(a) === unwrapValue(b) || targetsEqual(a, b);
}
function reportReplacedContainers(
  t: StoreTarget,
  old: Record<PropertyKey, any>,
  pb: Record<PropertyKey, any>,
  writtenKeys: Iterable<PropertyKey> | null
): void {
  const keys = writtenKeys ?? Reflect.ownKeys(pb);
  const isArray = Array.isArray(pb);
  const owner = storeRootOwner(t);
  for (const key of keys) {
    if ((isArray && key === "length") || key === $OWNER) continue;
    if (t.del !== null && t.del.has(key)) continue;
    const ov = unwrapValue(old[key as any]);
    const nv = unwrapValue(pb[key as any]);
    if (
      ov === null ||
      nv === null ||
      typeof ov !== "object" ||
      typeof nv !== "object" ||
      ov === nv ||
      targetsEqual(ov, nv)
    )
      continue;
    const isArr = Array.isArray(nv);
    if (isArr !== Array.isArray(ov)) continue;
    let total: number;
    let unchanged = 0;
    if (isArr) {
      total = (nv as unknown[]).length;
      if (total > REPLACED_CENSUS_MAX) continue;
      const oldItems = new Set<unknown>();
      for (const item of ov as unknown[]) oldItems.add(unwrapValue(item));
      for (const item of nv as unknown[]) if (oldItems.has(unwrapValue(item))) unchanged++;
    } else {
      const nkeys = Object.keys(nv);
      total = nkeys.length;
      if (total > REPLACED_CENSUS_MAX) continue;
      for (const k of nkeys) if (sameLeaf((ov as any)[k], (nv as any)[k])) unchanged++;
    }
    attrHooks!.storeReplaced(
      storePathOf(t) + "." + String(key),
      isArr,
      total,
      unchanged,
      isArr ? (ov as unknown[]).length : Object.keys(ov).length,
      owner
    );
  }
}

/** A user setter wrote a key whose staging is a derivation another
 * transaction holds (A34 (3), #3612): the hold re-derives over the write. */
let heldDerivationHit = false;
/** The open setter is a USER'S (`storeSetter(…, guard = true)`), not the
 * derive's draft or landing. */
let userWrite = false;
/** Is the open setter a user's? (reconcile.ts: a user's reconcile on an
 * optimistic family writes the draft.) */
export function userWriting(): boolean {
  return userWrite;
}
function heldDerivation(t: StoreTarget, node: Signal<any> | undefined, key: PropertyKey): boolean {
  if (t.fam === null || !userWrite) return false;
  if (node !== undefined)
    return (
      (node._config & (CONFIG_HELD | CONFIG_MANUAL_WRITE)) === CONFIG_HELD &&
      txOf(node) !== flushTransaction
    );
  const k = t.k;
  return (
    k !== null &&
    (k._config & CONFIG_HELD) !== 0 &&
    txOf(k) !== flushTransaction &&
    heldKeyChanged(t, key)
  );
}

/** Setter exit: one node write per changed observed key (the leaves stage
 * like signals — holds and lanes engage here on later steps), presence and
 * deep witnesses, and the container when membership changed. */
function notifyWrites(t: StoreTarget): void {
  let pb = t.pb;
  if (pb === null) return;
  // Optimistic channel: a user's writes on an optimistic family become
  // guesses on the nodes (lanes); the draft is discarded, the committed
  // backing never touched.
  if (userWrite && t.fam?.opt === true) {
    // The draft is discarded first: the diff reads the target (its nodes
    // are born from the committed frame, not the draft).
    t.pb = null;
    t.wk = null;
    t.pb = optHooks!.writes(t, pb);
    return;
  }
  const old = t.v;
  // Devtools mutation hook: full-key diff (dev-only cost) so unobserved
  // writes report too. Overlay backings materialize first so the diff walks
  // a real container.
  if (__DEV__ && DEV.hooks.onStoreNodeUpdate) {
    if (t.ovl) materializePB(t);
    pb = t.pb!;
    for (const key of Reflect.ownKeys(pb)) {
      if ((Array.isArray(pb) && key === "length") || key === $OWNER) continue;
      const ov = old[key as any];
      const nv = pb[key as any];
      if (!isEqual(ov, nv)) DEV.hooks.onStoreNodeUpdate(t.px, key, nv, ov);
    }
    for (const key of Reflect.ownKeys(old)) {
      if (key in pb || key === $OWNER) continue;
      DEV.hooks.onStoreNodeUpdate(t.px, key, undefined, old[key as any]);
    }
  }
  const nodes = t.n;
  // Written-keys bound: trap writes record their keys, so the notify visits
  // O(written) nodes instead of every subscription on the record (a selection
  // map with thousands of per-key subscribers pays two visits per select,
  // not a full scan). Falls back to the full node scan when the bound can't
  // hold: no trap granularity (wk null), an array length write (WK_ALL —
  // implicit index deletes), accessors on the record (t.a — a getter node's
  // value can change when ANY key is written), or a non-plain prototype
  // (class instances: prototype getters derive from arbitrary fields).
  // Overlay pbs chain to the COMMITTED object (#3044) — plainness is the
  // committed container's prototype, not the overlay's.
  const wk0 = t.wk;
  const writtenKeys =
    wk0 === WK_ALL || t.a === true || !plainProto(t.ovl ? (t.v as object) : pb) ? null : wk0;
  if (__OBSERVE__ && attrHooks !== null) reportReplacedContainers(t, old, pb, writtenKeys);
  if (t.fam !== null && !heldDerivationHit && writtenKeys !== null)
    for (const key of writtenKeys)
      if (heldDerivation(t, nodes?.[key as any], key)) {
        heldDerivationHit = true;
        break;
      }
  if (nodes !== null) {
    const keys: Iterable<PropertyKey> = writtenKeys ?? Reflect.ownKeys(nodes);
    for (const key of keys) {
      const node = nodes[key as any];
      if (node === undefined) continue;
      if (
        (node as any).acc === true ||
        (hasOwn.call(pb, key) && lookupGetter.call(pb, key) !== undefined)
      ) {
        // Accessor keys: the node is linked for shape-change notification,
        // its value is never served (the getter runs with the proxy
        // receiver on read) — FORCE wakes the readers.
        (node as any).acc = isOwnAccessor(pb, key);
        const od = Object.getOwnPropertyDescriptor(old, key);
        const nd = Object.getOwnPropertyDescriptor(pb, key);
        if ((od && (od.get || od.set)) || (nd && (nd.get || nd.set))) {
          if (od?.get !== nd?.get || od?.set !== nd?.set || od?.value !== nd?.value)
            setSignal(node, () => FORCE as any);
          continue;
        }
        if (!isEqual(od?.value, nd?.value)) setSignal(node, () => nd?.value);
        continue;
      }
      const nv = t.del !== null && t.del.has(key) ? undefined : pb[key as any];
      setSignal(node, () => nv);
      if (t.fam !== null) {
        // The derive's write is a derivation; a user setter's is a proposal
        // (A34 (3)'s discriminator).
        if (!userWrite) {
          node._config &= ~CONFIG_MANUAL_WRITE;
          holdWithDerive(t, node);
        } else node._config |= CONFIG_MANUAL_WRITE;
      }
    }
  }
  const has = t.h;
  if (has !== null) {
    const keys: Iterable<PropertyKey> = writtenKeys ?? Reflect.ownKeys(has);
    for (const key of keys) {
      const node = has[key as any];
      if (node !== undefined) {
        setSignal(node, key in pb && !(t.del !== null && t.del.has(key)));
        if (t.fam !== null) holdWithDerive(t, node);
      }
    }
  }
  if (t.dk !== null) {
    if (t.del !== null && t.del.size !== 0) bumpDeep(t);
    else
      for (const key of writtenKeys ?? Reflect.ownKeys(pb)) {
        if (key === $OWNER) continue;
        const nv = pb[key as any];
        const ov = old[key as any];
        if (nv !== null && typeof nv === "object" ? !targetsEqual(ov, nv) : !isEqual(ov, nv)) {
          bumpDeep(t);
          break;
        }
      }
  }
  // The container: structural readers hear membership/arrangement changes
  // only (R9) — the compare is the store's, against the committed frame. A
  // container carrying an arrangement guess is told whether or not anyone
  // subscribes: the write is a landing on the guess (`notifyContainer`).
  const k = t.k;
  if (k !== null && (k._subs !== null || k._config & CONFIG_OVERRIDE)) {
    let changed: boolean;
    if (t.ovl) {
      changed = t.del !== null && t.del.size !== 0;
      if (!changed) {
        for (const key of Reflect.ownKeys(pb)) {
          if (!hasOwn.call(old, key)) {
            changed = true;
            break;
          }
        }
      }
    } else {
      changed =
        Array.isArray(pb) && Array.isArray(old)
          ? arrayStructureChanged(old as any[], pb as any[])
          : membershipChanged(old, pb);
    }
    if (changed) notifyContainer(k, pb);
  }
}

/** Accessor-node wake sentinel: readers re-run and re-invoke the getter. */
const FORCE: unique symbol = Symbol();

/** Two raws that wrap to the same target are the same logical value. */
export function targetsEqual(ov: any, nv: any): boolean {
  if (ov === null || typeof ov !== "object" || nv === null || typeof nv !== "object") return false;
  const ot = lookupTarget(ov, null);
  return ot !== undefined && ot === lookupTarget(nv, null);
}

/** Positional identity IS content for arrays (R15). */
export function arrayStructureChanged(old: any[], neu: any[]): boolean {
  if (old.length !== neu.length) return true;
  for (let i = 0; i < neu.length; i++) {
    const ov = old[i];
    const nv = neu[i];
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) return true;
  }
  return false;
}

export function membershipChanged(
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): boolean {
  const nk = Reflect.ownKeys(neu);
  if (Reflect.ownKeys(old).length - +isOwned(old) !== nk.length - +isOwned(neu)) return true;
  for (const key of nk) if (key !== $OWNER && !(key in old)) return true;
  return false;
}

/** One leaf's notification for an adoption diff (descriptor-aware). */
export function notifyKeyDiff(
  node: Signal<any>,
  key: PropertyKey,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>,
  probe = true
): void {
  if (
    (node as any).acc === true ||
    (probe && hasOwn.call(neu, key) && lookupGetter.call(neu, key) !== undefined)
  ) {
    (node as any).acc = isOwnAccessor(neu, key);
    const od = Object.getOwnPropertyDescriptor(old, key);
    const nd = Object.getOwnPropertyDescriptor(neu, key);
    if ((od && (od.get || od.set)) || (nd && (nd.get || nd.set))) {
      if (od?.get !== nd?.get || od?.set !== nd?.set || od?.value !== nd?.value)
        setSignal(node, () => FORCE as any);
      return;
    }
    const ov = od?.value;
    const nv = nd?.value;
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv))
      setSignal(node, typeof nv === "function" ? () => nv : (nv as any));
  } else {
    const ov = old[key as any];
    const nv = neu[key as any];
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv))
      setSignal(node, typeof nv === "function" ? () => nv : (nv as any));
  }
}

export function hasAccessorFlag(node: Signal<any>): boolean {
  return (node as any).acc === true;
}

/** One leaf's notification when the caller already has both values. */
export function notifyKeyValue(
  node: Signal<any>,
  key: PropertyKey,
  ov: any,
  nv: any,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  if ((node as any).acc === true) {
    notifyKeyDiff(node, key, old, neu, false);
    return;
  }
  if (!isEqual(ov, nv) && !targetsEqual(ov, nv))
    setSignal(node, typeof nv === "function" ? () => nv : (nv as any));
}

/** The structural half of an adoption's notifications (reconcile does the
 * leaves itself): presence by `in`, the container by membership. Presence
 * is DIFFED `old` → `neu` like the leaves (#3743): a presence node is
 * written only where `in` changed between the view it was last told
 * (#3296) and the adoption — `setSignal` joins a held node's transaction
 * before its equality gate (A34 (1)), so repeating an unchanged absence to
 * a node an action holds would make the whole tick the action's (an
 * unrelated `a.value` stayed stale until the action settled). A real
 * change still writes, and on a held node still proposes. A live chained
 * `old` (a store proxy, §7b) reflects the inner store, not what the node
 * was last told — written unconditionally, as before.
 *
 * The container is told of an arrangement change when it has structural
 * subscribers OR carries an arrangement guess (S4): for a guessed
 * container the write is the landing that judges the guess (Q-D, plan
 * sec. 39 — confirm, supersede, or hold beneath), not a subscriber
 * notification, and a landing whose truth changed no guessed key's value
 * or presence (a newer question's rows beneath an optimistic push) still
 * answers the arrangement — before, only the presence write reached the
 * lane, by accident of being unconditional. */
export function notifyFoldTail(
  t: StoreTarget,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  const has = t.h;
  if (has !== null) {
    const live: StoreTarget | undefined = (old as any)[$TARGET];
    for (const key of Reflect.ownKeys(has))
      if (live || key in old !== key in neu) setSignal(has[key as any], key in neu);
  }
  const k = t.k;
  if (k !== null && (k._subs !== null || k._config & CONFIG_OVERRIDE)) {
    const changed =
      Array.isArray(neu) && Array.isArray(old)
        ? arrayStructureChanged(old as any[], neu as any[])
        : membershipChanged(old, neu);
    if (changed) notifyContainer(k, neu);
  }
}

/** An adoption's notifications: every node of the target, diffed `old` →
 * `neu` (value nodes by key, presence by `in`, the container by
 * membership, the deep witness by identity). */
export function notifyFold(
  t: StoreTarget,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  if (t.dk !== null && old !== neu) bumpDeep(t);
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) notifyKeyDiff(nodes[key as any], key, old, neu);
  }
  notifyFoldTail(t, old, neu);
}

// ---------------------------------------------------------------------------
// visibility

let writing = 0;
/** Roots of the stores with an open setter: reads of THEIR drafts are the
 * writer's (no tracking, pending backing served); every other store reads
 * normally — a derive's external reads are its dependencies (#3037). */
let writeScopes: Set<any> | null = null;
const pendingNotify = new Set<StoreTarget>();

function scopeKey(target: StoreTarget): any {
  if (target.fam !== null) return target.fam;
  let t = target;
  while (t.u !== null) t = t.u;
  return t;
}
function inDraft(target: StoreTarget): boolean {
  return writeScopes !== null && writeScopes.has(scopeKey(target));
}

/** Shallow store: values served verbatim (a nested store proxy still wraps
 * into the family so writes stay isolated). */
function serveShallow(target: StoreTarget, key: PropertyKey, v: any): any {
  if (v !== null && typeof v === "object" && (v as any)[$TARGET] !== undefined)
    return draftServe(target, wrap(v, target, key as any));
  return v;
}
/** A child proxy served to a draft joins the draft's scope. */
function draftServe(target: StoreTarget, proxy: any): any {
  if (writeScopes !== null && inDraft(target)) {
    const ct: StoreTarget | undefined = proxy?.[$TARGET];
    if (ct !== undefined && ct.v !== undefined) writeScopes.add(scopeKey(ct));
  }
  return proxy;
}

/** The committed backing: the container node's committed value while a
 * batch is staged on it (an adoption swaps `t.v` eagerly — INTERNALS §3,
 * "adoption is eager by contract" — and the node keeps the frame committed
 * readers under a hold still see), `t.v` otherwise. */
export function committed(t: StoreTarget): Record<PropertyKey, any> {
  const k = t.k;
  if (k !== null) return k._pendingValue !== NOT_PENDING ? asBacking(k._value) : t.v;
  // A node-less staging (`stageOn`): the fold queue remembers the frame.
  return t.pb !== null ? preBatch(t) : t.v;
}

/** The pass that sees this flush's staging (signal parity — `read()`'s
 * staged arm): the computation running (`context`, never the owner — a
 * handler, an effect callback or `onSettled` has an owner but no pass),
 * unless it is a frame reader (children-forbidden, A32). Null = the
 * committed frame. */
function stagingReader(): Computed<any> | null {
  let c: any = context;
  if (c === null) return null;
  if (c._root) c = c._parentComputed ?? null;
  return c === null || c._config & CONFIG_CHILDREN_FORBIDDEN ? null : c;
}

/** The backing a read serves (RUL-1, signal parity): the draft and the write
 * override read the pending backing; a tracked reader reads it too — only
 * for presence and descriptors, its leaf (born from the two frames) decides
 * the value through core; a context-free or frame reader the committed
 * backing; a pass reading UNTRACKED asks the container node — `read()`
 * without a link: the node's value is the backing, chosen by the hold rules
 * (a render effect outside the parking flush sees committed and re-derives
 * at the landing; a memo joins the future; a staging is marked read). */
/** The backing a read of `target` is served from — the truth (committed,
 * or the staging a pass may see). An optimistic family's lane values are
 * NOT composed here: a guessed key always has its node, and the node is
 * what serves its value (`nodeValue`); presence and enumeration compose
 * per key / per walk (`optimisticHas`, `enumerationSource`). */
function readSource(
  target: StoreTarget,
  key?: PropertyKey,
  shape = false
): Record<PropertyKey, any> {
  // An optimistic setter's read before its first write sees what the writer
  // sees — the lanes' values and the tick's own guesses over the truth
  // (#3665), never a staging awaiting its fold: the draft is born on the
  // read (and notified at the setter's exit like any).
  if (
    userWrite &&
    target.fam !== null &&
    target.fam.opt === true &&
    !pendingNotify.has(target) &&
    inDraft(target)
  ) {
    const draft = ensurePB(target);
    pendingNotify.add(target);
    return draft;
  }
  const pb = target.pb;
  if (pb === null) return target.v;
  if (inDraft(target) || writeOverride) {
    // The derive reads its own store through its draft: a key (or the
    // container) a transaction holds — a user's write inside an action,
    // held with it — is the future, and the pass that reads it derives
    // from the future (L2: a read of something already held joins it): the
    // derive's whole result reveals with the action (core R31 / #3733:
    // "under the transaction and revealed with it"), not key by key. A
    // user's setter reading its draft is no pass and joins nothing here.
    if (writeOverride && !userWrite) {
      const leaf = key !== undefined ? target.n?.[key as any] : undefined;
      if (leaf !== undefined) {
        if ((leaf._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD)
          joinPassTx(txOf(leaf));
      } else {
        const k = target.k;
        if (
          k !== null &&
          (k._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD &&
          (key === undefined || heldKeyChanged(target, key))
        )
          joinPassTx(txOf(k));
      }
    }
    return pb;
  }
  const k = target.k;
  // A key whose leaf carries a lane's value (a guess, S4): the leaf serves
  // it — the container's frame is not consulted (a reader is not made a
  // stale reader of the container's hold for a key it does not see through
  // it).
  if (key !== undefined) {
    const leaf = target.n?.[key as any];
    if (leaf !== undefined && leaf._config & CONFIG_OVERRIDE) return committed(target);
  }
  const held = k !== null && (k._config & CONFIG_HELD) !== 0;
  // A held container: the hold's unit is the key (#3706). A key the HELD
  // staging left unchanged reads the ambient view — a mainline layer's
  // write above the hold publishes mainline (#3688, #3612); a key it
  // changed reads the frame core serves this reader.
  if (held && key !== undefined && !heldKeyChanged(target, key, shape)) return pb;
  const c = stagingReader();
  if (c === null) {
    if (getObserver() !== null) return pb; // a frame reader's leaf decides the value
    // A projection's writes are its truth as soon as made (the derive is
    // the authority, nothing it writes is a proposal): a context-free reader
    // sees them before the flush — unless a hold keeps them staged.
    if (familyAhead(target)) return pb;
    // A verdict window (`isPending`/`latest`) with no reader (a top-level
    // probe) judges the container like any node — for a key the batch
    // changed; an unchanged key is committed and final (A22: pending is per
    // key). A held container's committed frame is the node's.
    if (verdict === null || (!held && key !== undefined && !keyChanged(target, key, shape)))
      return held ? asBacking(k!._value) : target.v;
    return k === null ? committed(target) : asBacking(readNode(k));
  }
  // A pass reading a key the batch left unchanged: the same value in both
  // frames — committed, holding no one. Otherwise the container's frame by
  // core's rules — `read()` of the node WITHOUT a link (a value reader never
  // subscribes to the container): a render effect outside a hold's flush
  // sees committed and re-derives at the landing, a memo joins the future,
  // a staging read is marked. The key's own leaf, when it has one, decides
  // the value the same way.
  if (!held) {
    // A plain pass this flush already served a staging as the screen
    // (REACTIVE_STAGED_READ — what `read()` would set again here) reads an
    // unheld staging directly: an unchanged key is the same value in both
    // frames, a changed one is what the mark already stands for. The
    // per-key question is asked once per pass, not once per key (a
    // `mapArray` over 1k shifted rows asked it 1k times).
    if (
      c._flags & REACTIVE_STAGED_READ &&
      !(c._config & (CONFIG_VERDICT | CONFIG_CHILDREN_FORBIDDEN))
    )
      return pb;
    if (key !== undefined && !keyChanged(target, key, shape)) return committed(target);
    // A node-less staging (`stageOn`): what `read()` of its node would do
    // for this pass — a verdict reader sees the screen, any other derives
    // from the staging and is marked as having read it.
    if (k === null) {
      if (c._config & CONFIG_VERDICT && stagedScreen(c)) return committed(target);
      stagedRead(c);
      return pb;
    }
  }
  return asBacking(untrack(() => readNode(k)));
}

/** Did the HELD staging (the container node's, not a mainline layer above
 * it) change `key`? */
function heldKeyChanged(target: StoreTarget, key: PropertyKey, shape = true): boolean {
  return changedBetween(target, target.k!._value, target.k!._pendingValue, key, shape);
}

/** A family target's unheld staging, read with no pass (a handler). */
function familyAhead(target: StoreTarget): boolean {
  return (
    target.fam !== null &&
    context === null &&
    !(target.k !== null && target.k._config & CONFIG_HELD)
  );
}

/** Did this batch change `key` — value (slot equality), presence, and (for
 * a `shape` reader — a descriptor read, a node's hold) enumerability or
 * accessor-ness? A swapped or non-plain prototype, or a chained backing,
 * changes every key (#3706: those hold the whole container).
 *
 * A VALUE read asks without `shape`: a key whose value is the same in both
 * frames serves the same value from either, whatever its descriptor did —
 * and the descriptor probes (`__lookupGetter__`, `propertyIsEnumerable`,
 * twice each) are the cost of the question on a wide container read under
 * a staging (a keyed reconcile's 1k rows, read by `mapArray` in the flush
 * that staged them: ~3× the tick). A container with accessors seen (`a`)
 * keeps the full test — a getter's answer is not a slot's. */
function keyChanged(target: StoreTarget, key: PropertyKey, shape = true): boolean {
  return changedBetween(target, committed(target), target.pb!, key, shape);
}

function changedBetween(
  target: StoreTarget,
  v: Record<PropertyKey, any>,
  pb: Record<PropertyKey, any>,
  key: PropertyKey,
  shape: boolean
): boolean {
  if (
    target.ch ||
    (pb as any)[$TARGET] !== undefined ||
    Object.getPrototypeOf(pb) !== Object.getPrototypeOf(v) ||
    !plainProto(v)
  )
    return true;
  if (target.del !== null && target.del.has(key)) return key in v;
  const inNew = hasOwn.call(pb, key) || (target.ovl && hasOwn.call(target.v, key));
  if (inNew !== hasOwn.call(v, key)) return true;
  if (!inNew) return false;
  if (
    (shape || target.a) &&
    (isOwnAccessor(v, key) ||
      isOwnAccessor(pb, key) ||
      propertyIsEnumerable.call(v, key) !== propertyIsEnumerable.call(pb, key))
  )
    return true;
  const nv = pb[key as any];
  const ov = v[key as any];
  return !isEqual(ov, nv) && !sameLogicalSlot(target, ov, nv);
}

/** Value of a key with a leaf: core's — `read()` links a tracked reader and,
 * tracked or not, applies the hold and A28 rules a signal's read does. A
 * projection's unheld staging is ahead for a handler (`familyAhead`). */
function nodeValue(node: Signal<any>, backing: any, target: StoreTarget): any {
  let v = readNode(node);
  if (
    node._pendingValue !== NOT_PENDING &&
    !(node._config & CONFIG_HELD) &&
    context === null &&
    target.fam !== null
  )
    v = node._pendingValue;
  return v === (FORCE as any) ? backing : v;
}

/** Serve a present data key: link the leaf for a tracked reader (creating it
 * on first read), wrap a wrappable child through the per-node wrap cache. */
function serveDataKey(
  target: StoreTarget,
  key: PropertyKey,
  backingValue: any,
  src: Record<PropertyKey, any>,
  node?: Signal<any>,
  accKnown: -1 | 0 | 1 = -1
): any {
  // Read-through (§7b): the inner store's node is the truth; the outer's is
  // a subscription point only — unless it carries a guess (an optimistic
  // store over a store: the guess is the outer's, shown over the inner).
  const chained = target.ch && src === target.v;
  let v = backingValue;
  // A write-override read (a derive's draft) serves the backing: the derive
  // composes on the truth, never on a lane's or a hold's frame.
  if (!inDraft(target) && !writeOverride) {
    if (node === undefined && getObserver() !== null) node = getNode(target, key, accKnown);
    if (node !== undefined) {
      const nv = nodeValue(node, backingValue, target);
      if (chained) {
        // The link's committed value follows the inner store's (what a lane
        // over it covers — its reveal and revert compare against it, S4).
        node._value = backingValue;
        if (node._config & CONFIG_OVERRIDE) v = nv;
      } else v = nv;
    }
  }
  if (target.s) return serveShallow(target, key, v);
  // A derive's draft wrapper answers `$TARGET` without being a proxy: the
  // inner store's alias (#3767), resolved like a raw (#3859).
  if (target.ch && !chained && v !== null && typeof v === "object" && v[$TARGET]?.px !== v)
    v = resolveChainedRaw(target, key, v);
  if (node !== undefined) {
    if ((node as any).pxv === v && v !== undefined) return draftServe(target, (node as any).px);
    if (!isWrappable(v)) return v;
    const p = wrap(v, target, key as any);
    (node as any).px = p;
    (node as any).pxv = v;
    return draftServe(target, p);
  }
  if (!isWrappable(v)) return v;
  return draftServe(target, wrap(v, target, key as any));
}

/** Is `n` among `c`'s dependencies (any pass's — a kept tail included)? */
function linkedTo(c: Computed<any>, n: Signal<any>): boolean {
  for (let d = c._deps; d !== null; d = d._nextDep) if (d._dep === n) return true;
  return false;
}

/** The projection's obligation (plan sec. 31.7 Q-B): before any value is served
 * through a family target, the derive — the firewall — is brought up to
 * date WITHOUT the reader subscribing to it. Core's `read()` of the
 * firewall with no link does all of it: the pull, the status gate
 * (uninitialized / pending → NotReady, errored → the error; a verdict
 * window judges it; a pending source registers the reader for the landing)
 * and the reader's height. The derive's own draft ops are exempt (the write
 * override): the derive is the author. */
function pullFamily(target: StoreTarget): void {
  const fw = target.fam!.node;
  if (fw === null || writeOverride || inDraft(target)) return;
  // A settled derive: the pull alone, no link (the barrier). A derive with a
  // flight up (or errored): the reader observes the flight exactly as a
  // reader of a memo would — linked, so it re-runs at the landing (the
  // next settled pass pulls without linking and the stale link trims), a
  // verdict reader registered, a tracked pass suspended.
  if (fw._statusFlags & (STATUS_PENDING | STATUS_ERROR)) {
    // A render effect outside the flight's own flush is the frame, not a
    // derivation: it keeps what it shows and learns of the landing from the
    // leaves the landing changes (unchanged leaves say nothing — it is not a
    // stale reader of the derive). Inside the flush it suspends like any.
    // One that already observes the flight (linked by the pass that saw it
    // go up — the frame's hold, `blocked`) keeps observing it: a re-run for
    // another reason (a guess it read, the seam) that dropped the link would
    // release the hold with the flight still up.
    const c: any = context;
    if (
      c !== null &&
      c._type === EFFECT_RENDER &&
      fw._config & CONFIG_HELD &&
      flushTransaction !== txOf(fw) &&
      !linkedTo(c, fw)
    )
      return;
    // An optimistic family carrying guesses that stand in for the flight
    // (A17): the guesses are the display — a reader is served the leaves
    // (committed plus the guesses) and does not suspend on the derive; a
    // verdict window still asks it (`isPending` is true while the flight is
    // up). The family's, not the target's: the edit stands in for the one
    // flight the family has.
    const overlaid = target.fam!.overlaid;
    if (
      verdict === null &&
      fw._statusFlags & STATUS_PENDING &&
      overlaid !== undefined &&
      overlaid.size !== 0
    )
      return;
    readNode(fw);
  } else untrack(() => readNode(fw));
}

/** A projection's writes are its derive's: a staging made while the derive
 * is held (a flight up — its continuation writes after an `await`, a
 * callback's late write) belongs to the derive's transaction and reveals
 * with it, never drained early — and answers the derive's question: a quiet
 * re-ask's landing is quiet through its reveal (A19 exc. 2; the leaf's own
 * classification, as core reads it — `heldNotFinal`). */
function holdWithDerive(target: StoreTarget, node: Signal<any>): void {
  const fw = target.fam?.node;
  if (
    fw !== undefined &&
    fw !== null &&
    !userWrite && // the derive's own write (its draft or landing), not a user setter's
    fw._config & CONFIG_HELD &&
    node._pendingValue !== NOT_PENDING &&
    // A node carrying a guess is the lane's: its staging is the truth beneath
    // the guess (`setSignal` → `laneWrite`), never re-homed by the store.
    !(node._config & (CONFIG_HELD | CONFIG_OVERRIDE))
  ) {
    holdNode(node, txOf(fw));
    node._x!._reask = fw._x!._reask;
  }
}

/** A chained backing's child (§7b): a raw the inner family owns, or holds
 * at this key, is served as the inner store's wrapper — never a fresh
 * raw-keyed one — so the chained targets are the same objects across
 * settled and pending views. */
export function resolveChainedRaw(target: StoreTarget, key: PropertyKey, v: object): any {
  const innerT: StoreTarget = (target.v as any)[$TARGET];
  if (innerT.ch) {
    const iv = resolveChainedRaw(innerT, key, v);
    return iv === v ? v : wrap(iv, innerT, key);
  }
  const owned = lookupTarget(v, innerT.fam);
  if (owned !== undefined) return owned.px;
  if ((innerT.v[key as any] === v || innerT.pb?.[key as any] === v) && isWrappable(v))
    return wrap(v, innerT, key);
  return v;
}

/** The backing a structural read serves: a tracked reader subscribes to the
 * container and reads the frame core serves it — committed or staging by
 * the hold rules (`read()` on the node: the node's value IS the backing);
 * anyone else reads by `readSource`. */
function enumerationSource(target: StoreTarget): Record<PropertyKey, any> {
  if (!inDraft(target) && !writeOverride && getObserver() !== null) {
    // A container's arrangement guess is not a backing: the view composes
    // over the base it is shown over.
    const base = asBacking(readNode(getContainerNode(target)));
    return target.fam?.opt === true ? optHooks!.view(target, base) : base;
  }
  const src = readSource(target);
  return optRead(target) ? optHooks!.view(target, src) : src;
}

/** A read on an optimistic family that composes the lanes' values: not the
 * draft's (it composed already), not a derive's write-override read (the
 * derive composes on the truth). */
function optRead(target: StoreTarget): boolean {
  return target.fam !== null && target.fam.opt === true && !inDraft(target) && !writeOverride;
}

/** Pollution keys are never served from the prototype (core R30). */
const UNSAFE_KEYS = new Set<PropertyKey>(["__proto__", "prototype", "constructor"]);

// ---------------------------------------------------------------------------
// traps

const traps: ProxyHandler<StoreTarget> = {
  get(target, key, receiver) {
    // One typeof gates every brand-symbol compare off the hot string path.
    if (typeof key !== "string") {
      if (key === $TARGET) return target;
      if (key === $PROXY) return receiver;
      if (key === $OWNER) return undefined; // ownership stamp: never a user key
      if (key === $RECORD) return undefined; // a store is no view (see `viewOf`)
      // refresh()/isPending resolve the projection computed through $REFRESH.
      if (key === $REFRESH) return target.fam?.node ?? undefined;
      if (key === $TRACK) {
        if (target.fam !== null) pullFamily(target);
        if (!inDraft(target) && getObserver() !== null) {
          readNode(getContainerNode(target));
          // Structural chaining (§7b): a chained backing's $TRACK reads
          // through to the INNER store's container — structural
          // notifications land on the source's own node.
          const srcT = readSource(target);
          if ((srcT as any)[$TARGET] !== undefined) (srcT as any)[$TRACK];
        }
        return undefined;
      }
      // user symbols fall through to the generic path
    }
    // (The witness before the pull: a mark on an uninitialized derived
    // store is witnessed, then the pull throws — loading, declared pending.)
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks.witness(target, key);
    if (target.fam !== null) pullFamily(target);
    // Hot inline case: existing PLAIN node (non-accessor) read outside any
    // draft — the dbmon/uibench effect re-read shape. Core's `read()` serves
    // it (linking a tracked reader; the hold rules either way). Skips
    // serveDataKey's frame, the FORCE compare (only accessor keys ever hold
    // the sentinel), and isWrappable for primitives. ONE node-map lookup
    // serves this block and the accessor probe below. Before the backing is
    // consulted: a deleted key's node serves `undefined` (notifyWrites), and
    // a chained target's node carrying a GUESS is the value (A17 — the base
    // beneath it, and any hold there, is not this reader's concern; a link
    // without one reads through below).
    const node0 = target.n?.[key as any];
    if (writeScopes === null && !writeOverride) {
      const nodeH = node0;
      if (
        nodeH !== undefined &&
        (nodeH as any).acc !== true &&
        (!target.ch || nodeH._config & CONFIG_OVERRIDE)
      ) {
        const nv = nodeValue(nodeH, undefined, target);
        if (nv === null || typeof nv !== "object") return nv;
        if (target.s) return serveShallow(target, key, nv);
        if ((nodeH as any).pxv === nv) return (nodeH as any).px;
        if (isWrappable(nv)) {
          const p = wrap(nv, target, key);
          (nodeH as any).px = p;
          (nodeH as any).pxv = nv;
          return p;
        }
        return nv;
      }
    }
    const src = readSource(target, key);
    // Overlay delete (#3044): a prototype overlay cannot shadow a delete, so
    // deleted keys are tracked aside and read as absent in the pending view.
    if (target.del !== null && src === target.pb && target.del.has(key)) {
      if (!inDraft(target) && getObserver() !== null) readNode(getNode(target, key));
      return undefined;
    }
    if (
      __DEV__ &&
      asyncTailFlights !== 0 &&
      untrackDepth === 0 &&
      !inDraft(target) &&
      typeof key === "string" &&
      key !== "then" &&
      getObserver() === null &&
      // Own data keys only: a pending backing inherits unrewritten keys from `v`.
      (hasOwn.call(src, key) || hasOwn.call(target.v, key))
    )
      // Once per store per computation: the holder is the root target, so a
      // row walk (`items.map(i => i.name)`) after an await reports the first
      // untracked key it touched, not one warning per row proxy.
      checkPostAwaitRead(target.n?.[key as any], storeRoot(target), undefined, key, false);
    // Dev strictRead: untracked store reads in labeled scopes (component
    // bodies, effect callbacks) warn — the value can never update the
    // reader. `then` is exempt: resolving a promise with a store proxy makes
    // the engine probe `.then` synchronously in the caller's scope — not a
    // read the user wrote.
    if (
      __DEV__ &&
      strictRead &&
      !inDraft(target) &&
      typeof key === "string" &&
      key !== "then" &&
      getObserver() === null
    ) {
      warnStrictReadUntracked(strictRead, {
        nodeName: key,
        data: { strictRead, property: key, source: "store" }
      });
    }
    // Accessor keys serve through Reflect.get with the PROXY receiver
    // (R20/R29: internal reads track; the node is linked for shape-change
    // notification but its value is never served). Accessor-ness comes from
    // the node's cached flag; the first TRACKED read (which creates the
    // node) probes once — untracked node-less reads take the plain path,
    // where a raw-receiver getter still returns correct committed values.
    // Tracking suppression is PER-TARGET (inDraft), never global (#3037).
    let accProbe: -1 | 0 | 1 = -1;
    {
      let acc: boolean;
      if (node0 !== undefined) acc = (node0 as any).acc === true;
      else if (!inDraft(target) && getObserver() !== null) {
        acc = isOwnAccessor(src, key);
        if (src === (target.pb ?? target.v)) accProbe = acc ? 1 : 0;
      } else acc = false;
      if (acc) {
        if (!inDraft(target) && getObserver() !== null)
          readNode(node0 ?? getNode(target, key, accProbe));
        const v = Reflect.get(src, key, receiver);
        if (target.s) return serveShallow(target, key, v);
        return isWrappable(v) ? draftServe(target, wrap(v, target, key)) : v;
      }
    }
    // Plain-data fast path: no descriptor allocation per read. Inherited
    // pollution keys are never served (core R30) — checked before the
    // proto-function branch can leak `constructor`. Overlay pending backings
    // chain to the committed backing, so "own in the view" means own on
    // either layer — a genuine prototype method is one that is own on
    // NEITHER.
    const viewOvl = target.ovl && src === target.pb;
    if (
      (key === "constructor" || key === "__proto__" || key === "prototype") &&
      !hasOwn.call(src, key) &&
      !(viewOvl && hasOwn.call(target.v, key))
    )
      return undefined;
    let v = (src as any)[key];
    if (
      v === undefined ? !hasOwn.call(src, key) && !(viewOvl && hasOwn.call(target.v, key)) : false
    ) {
      // Inherited: prototype getters/methods run with the proxy receiver.
      v = Reflect.get(src, key, receiver);
      if (typeof v === "function") return v; // proto methods untracked
      // Read-through (§7b): the inner store answers an absent key too — the
      // outer's node is a subscription point unless it carries a guess.
      if (target.ch && src === target.v) return serveDataKey(target, key, v, src, node0, accProbe);
      // Reading a currently-absent own key subscribes to it (R12) — for any
      // target OUTSIDE its own draft scope, even mid-setter (#3037, above).
      if (v === undefined && !inDraft(target)) {
        if (getObserver() !== null) readNode(getNode(target, key, accProbe));
        const node = target.n?.[key];
        if (node) {
          const nv = nodeValue(node, undefined, target);
          if (target.s) return serveShallow(target, key, nv);
          return isWrappable(nv) ? draftServe(target, wrap(nv, target, key)) : nv;
        }
      }
      if (target.s) return serveShallow(target, key, v);
      return isWrappable(v) ? draftServe(target, wrap(v, target, key)) : v;
    }
    if (
      typeof v === "function" &&
      !hasOwn.call(src, key) &&
      !(viewOvl && hasOwn.call(target.v, key))
    )
      return v; // proto method
    return serveDataKey(target, key, v, src, node0, accProbe);
  },

  has(target, key) {
    if (key === $TARGET || key === $PROXY || key === $TRACK) return true;
    if (key === $OWNER || key === $RECORD) return false;
    // (The witness before the pull: a mark on an uninitialized derived
    // store is witnessed, then the pull throws — loading, declared pending.)
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks.witness(target, key);
    if (target.fam !== null) pullFamily(target);
    const src = readSource(target, key);
    // A tracked reader's presence node answers (born from the two frames;
    // core decides which it sees); everyone else reads the backing. A
    // chained target's node is a subscription point (§7b): the inner store
    // answers through the backing — unless the outer node carries a guess.
    if (!inDraft(target) && !writeOverride) {
      if (getObserver() !== null) {
        const node = getHasNode(target, key);
        const nv = readNode(node);
        if (!target.ch || src !== target.v) return !!nv;
        const present = key in src;
        node._value = present; // the link follows the inner store (S4)
        if (node._config & CONFIG_OVERRIDE) return !!nv;
        return present;
      } else if (optRead(target)) {
        const guessed = optHooks!.has(target, key);
        if (guessed !== undefined) return guessed;
      }
    }
    return key in src && !(target.del !== null && src === target.pb && target.del.has(key));
  },

  ownKeys(target) {
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks.witness(target, undefined);
    if (target.fam !== null) pullFamily(target);
    return visibleKeys(target, enumerationSource(target));
  },

  getOwnPropertyDescriptor(target, key) {
    if (key === $OWNER || key === $RECORD) return undefined;
    const obs = getObserver();
    if (verdict !== null && affectsHooks !== null && obs === null)
      affectsHooks.witness(target, key);
    if (target.fam !== null) pullFamily(target);
    // An enumerator (spread, Object.entries) already holds the container
    // node and reads its frame; a descriptor read on its own tracks
    // presence (R13).
    const plain = obs !== null && !inDraft(target) && !writeOverride;
    const enumerating = plain && observerHoldsContainer(target, obs);
    let src: Record<PropertyKey, any>;
    if (enumerating) src = enumerationSource(target);
    else if (plain) {
      // The presence node's frame (core decides which) is the one described
      // (a chained target's inner store answers through the backing, §7b);
      // the descriptor itself comes from the backing the container's frame
      // serves this reader (`readSource`: a held container's changed key —
      // enumerability, accessor-ness — reads committed for a stale reader,
      // the staging for a member; #3706 contrast).
      const node = getHasNode(target, key);
      const present = readNode(node);
      src = readSource(target, key, true);
      if (!present && (!target.ch || node._config & CONFIG_OVERRIDE || !(key in src)))
        return undefined;
    } else src = readSource(target, key, true);
    let desc: PropertyDescriptor | undefined;
    if (!enumerating && optRead(target)) {
      const guessed = optHooks!.descriptor(target, key);
      if (guessed === null) return undefined;
      desc = guessed;
    }
    desc ??= visibleDescriptor(target, src, key);
    if (desc === undefined) return undefined;
    if (!(key === "length" && Array.isArray(target))) desc.configurable = true;
    return desc;
  },

  set(target, key, value) {
    const draft = inDraft(target);
    const override = !draft && writeOverride;
    if (!draft && !override) return true;
    if (key === "__proto__") return true; // pollution guard (core R30)
    const uv = target.s ? value : unwrapValue(value);
    const pb = ensurePB(target);
    pendingNotify.add(target);
    if (Array.isArray(pb)) {
      if (key === "length") target.wk = WK_ALL;
      else if (target.wk !== WK_ALL) {
        const wk = (target.wk ??= new Set());
        wk.add(key);
        wk.add("length");
      }
    } else {
      if (target.wk !== WK_ALL) (target.wk ??= new Set()).add(key);
      if (!(key in pb)) target.kc++;
    }
    if (UNSAFE_KEYS.has(key)) {
      Object.defineProperty(pb, key, {
        value: uv,
        writable: true,
        enumerable: true,
        configurable: true
      });
      if (target.del !== null) target.del.delete(key);
      return true;
    }
    if (target.ovl && target.sc !== 2 && !hasOwn.call(pb, key)) {
      Object.defineProperty(pb, key, {
        value: uv,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } else pb[key as any] = uv;
    if (target.del !== null) target.del.delete(key);
    if (target.s && uv !== null && typeof uv === "object") markRawOne(uv);
    if (override) notifyWrites(target);
    return true;
  },

  defineProperty(target, key, desc) {
    const draft = inDraft(target);
    const override = !draft && writeOverride;
    if (!draft && !override) return true;
    if (key === "__proto__") return true;
    if (desc.get || desc.set) target.a = true;
    if ("value" in desc) desc = { ...desc, value: unwrapValue(desc.value) };
    const pb = ensurePB(target);
    if (target.a || !(desc.enumerable && desc.writable && desc.configurable)) target.sc = 1;
    pendingNotify.add(target);
    if (target.wk !== WK_ALL) (target.wk ??= new Set()).add(key);
    Object.defineProperty(pb, key, desc);
    if (target.del !== null) target.del.delete(key);
    if (override) notifyWrites(target);
    return true;
  },

  deleteProperty(target, key) {
    const draft = inDraft(target);
    const override = !draft && writeOverride;
    if (!draft && !override) return true;
    const pb = ensurePB(target);
    pendingNotify.add(target);
    if (target.wk !== WK_ALL) (target.wk ??= new Set()).add(key);
    delete pb[key as any];
    if (target.ovl && hasOwn.call(target.v, key)) (target.del ??= new Set()).add(key);
    if (override) notifyWrites(target);
    return true;
  }
};

/** Is `obs` subscribed to the container BY THIS PASS (its enumerator holds
 * it)? A link left from a previous pass is stale — the reader must subscribe
 * to the key's presence node or a later add never re-runs it. */
function observerHoldsContainer(target: StoreTarget, obs: Owner): boolean {
  const k = target.k;
  if (k === null) return false;
  const l = k._subsTail;
  return (
    l !== null &&
    l._sub === obs &&
    (!((obs as Computed<any>)._flags & REACTIVE_RECOMPUTING_DEPS) ||
      l._gen === (obs as Computed<any>)._depGen)
  );
}

// ---------------------------------------------------------------------------
// setter / createStore

const ASYNC_STORE_SETTER_MESSAGE =
  "[ASYNC_STORE_SETTER] Store setter callback returned a Promise. A store setter is a synchronous transaction: " +
  "the draft closes when the callback returns, so writes after an `await` are lost. " +
  "Move the await into an action() and call the setter from there.";

/** A store setter inside an owned scope (a memo body) is the owned-scope
 * write violation — the user guard (`mapArray`'s pattern: the node-level
 * writes carry `ownedWrite`; the setter asks). */
function devGuardStoreSetterWrite(): void {
  if (context && !(context._config & CONFIG_CHILDREN_FORBIDDEN)) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      data: { operation: "setStore" }
    });
    throw new Error(ownedScopeWriteMessage(context));
  }
}

/** The callback's return has one meaning — a replacement root to adopt — and
 * a thenable can never be that: it is the signature of `setStore(async d =>
 * …)`, where only the writes before the first `await` were in the
 * transaction. Setters are synchronous; async orchestration is `action()`'s. */
function devGuardStoreSetterResult(result: unknown): void {
  if (result == null) return;
  if (
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as PromiseLike<unknown>).then === "function"
  ) {
    emitDiagnostic({
      code: "ASYNC_STORE_SETTER",
      kind: "write",
      severity: "error",
      message: ASYNC_STORE_SETTER_MESSAGE,
      ownerId: context?.id,
      ownerName: (context as any)?._name,
      data: { operation: "setStore" }
    });
    throw new Error(ASYNC_STORE_SETTER_MESSAGE);
  }
}

export function storeSetter<T>(proxy: T, fn: (draft: T) => T | void, guard = true): void {
  if (__DEV__ && guard) devGuardStoreSetterWrite();
  const target: StoreTarget = (proxy as any)[$TARGET];
  const prevScopes = writeScopes;
  writeScopes = new Set();
  writeScopes.add(scopeKey(target));
  const prevUser = userWrite;
  userWrite = guard;
  writing++;
  let result: any;
  try {
    // No untrack: the writing flag already disables store-node linking
    // (draft reads never self-track, proj R2), while EXTERNAL reads (signals
    // inside a projection derive) must keep tracking — they are the derive's
    // dependencies.
    result = fn(proxy);
  } finally {
    writing--;
    writeScopes = prevScopes;
    // Outermost setter exit: emit write-time notifications (one node write
    // per changed observed key) so holds and lanes engage now.
    if (writing === 0 && pendingNotify.size) {
      const touched = [...pendingNotify];
      pendingNotify.clear();
      for (const t of touched) notifyWrites(t);
      // A direct commit (a projection's creation run) folds at the setter's
      // exit, unqueued: the backing is the pre-batch one (nothing swapped).
      if (directCommit) for (const t of touched) if (t.pb !== null) foldTarget(t, t.v);
    }
    userWrite = prevUser;
  }
  // After the sync writes have notified (they were real, like an effect's
  // side effects before its invalid-cleanup throw) and before adoption.
  if (__DEV__ && guard) devGuardStoreSetterResult(result);
  if (result !== undefined && result !== proxy && isWrappable(result)) {
    // A returned replacement: on an optimistic family a user's is itself an
    // optimistic edit — diffed against the view as guesses (`next` parity);
    // otherwise it is adopted as the incoming truth.
    if (guard && target.fam?.opt === true && !writeOverride)
      optHooks!.writes(target, unwrapValue(result));
    else adoptPB(target, unwrapValue(result));
  }
  // A34 (3), #3612 — the derived store's twin of `setMemo`: a user write to
  // a derivation another transaction holds is nobody's proposal; it becomes
  // the draft's prior state and the hold re-derives over it (the writes
  // joined the hold through `setSignal`; the derive re-runs under it).
  if (guard && heldDerivationHit) {
    heldDerivationHit = false;
    const fw = target.fam!.node!;
    if (!(fw._flags & REACTIVE_DIRTY)) {
      fw._flags = (fw._flags & ~REACTIVE_CHECK) | REACTIVE_DIRTY;
      insertIntoHeap(fw, dirtyQueue);
      schedule();
    }
  }
}

export function createStore<T extends Record<PropertyKey, any>>(
  initialValue: T,
  options?: StoreOptions
): [T, SetStoreFunction<T>] {
  const shallow = options?.shallow === true;
  if (shallow && __DEV__) {
    // Never both deep-wrapped and raw (R41/R44): a value already tracked as
    // a DEEP store cannot be ingested shallow.
    const existing = lookupTarget(initialValue, null);
    if (existing !== undefined && !existing.s)
      throw new Error("createStore({ shallow }): value is already tracked as a deep store");
    if ((initialValue as any)[$TARGET])
      throw new Error("createStore({ shallow }): value is already a store proxy");
  }
  const proxy = wrap(initialValue);
  if (shallow) {
    ((proxy as any)[$TARGET] as StoreTarget).s = true;
    markRawIngest(initialValue);
  }
  if (__OBSERVE__) {
    const owner = getOwner();
    // Dev-tier graph registration (owner signal lists, onGraph); the
    // `_owner` write itself never reaches the proxy, see storeOwners.
    registerGraph(proxy, owner);
    // Only once the engine is installed, like the node stamping it feeds: a
    // WeakMap.set per fresh store is a growing ephemeron table and,
    // disabled, buys nothing.
    if (attrHooks !== null) {
      storeOwners!.set((proxy as any)[$TARGET] as StoreTarget, owner);
      nameStore(proxy, options?.name);
    }
  }
  const setter: SetStoreFunction<T> = fn => storeSetter(proxy, fn);
  return [proxy, setter];
}

/** True when `proxy` is a SHALLOW store (children served verbatim, slots
 * replaced by reference — #2932). The list driver uses this to choose the
 * slot-patch channel (collected row bodies) over per-record registration. */
export function storeIsShallow(proxy: any): boolean {
  const t: StoreTarget | undefined = proxy?.[$TARGET];
  return t !== undefined && t.s === true;
}

/** True when `proxy` belongs to a projection family (S3). */
export function storeHasFamily(proxy: any): boolean {
  const t: StoreTarget | undefined = proxy?.[$TARGET];
  return t !== undefined && t.fam !== null;
}

/** True when `proxy` belongs to an OPTIMISTIC family (S4). */
export function storeHasOptimisticFamily(proxy: any): boolean {
  const t: StoreTarget | undefined = proxy?.[$TARGET];
  return t !== undefined && t.fam?.opt === true;
}

// ---------------------------------------------------------------------------
// enumeration views (one visibility rule for the traps AND the deep walk)

function visibleKeys(target: StoreTarget, src: Record<PropertyKey, any>): (string | symbol)[] {
  let keys: (string | symbol)[];
  if (target.ovl && src === target.pb) {
    keys = Reflect.ownKeys(target.v);
    const del = target.del;
    if (del !== null && del.size !== 0) keys = keys.filter(key => !del.has(key));
    for (const key of Reflect.ownKeys(src)) {
      if (!hasOwn.call(target.v, key)) keys.push(key);
    }
  } else keys = Reflect.ownKeys(src);
  // The ownership stamp is the last symbol on an owned backing: hide it.
  for (let i = keys.length - 1; i >= 0 && typeof keys[i] === "symbol"; i--) {
    if (keys[i] === $OWNER) {
      keys.splice(i, 1);
      break;
    }
  }
  return keys;
}

function visibleDescriptor(
  target: StoreTarget,
  src: Record<PropertyKey, any>,
  key: PropertyKey
): PropertyDescriptor | undefined {
  let desc = Object.getOwnPropertyDescriptor(src, key);
  if (target.ovl && src === target.pb) {
    if (target.del !== null && target.del.has(key)) return undefined;
    if (desc === undefined) desc = Object.getOwnPropertyDescriptor(target.v, key);
  }
  return desc;
}

// ---------------------------------------------------------------------------
// deep / snapshot

/** Tracking snapshot: subscribes every reachable record's container and deep
 * witness (one node per record, not one per path), then snapshots. */
export function deep<T>(value: T): T {
  const t0: StoreTarget | undefined = (value as any)?.[$TARGET];
  if (t0 === undefined || t0.px !== value) return value;
  const visited = new Set<object>();
  const childTarget = (
    t: StoreTarget,
    child: object,
    key: PropertyKey
  ): StoreTarget | undefined => {
    let ct: StoreTarget | undefined = lookupTarget(child, t.fam);
    if (ct === undefined) {
      if (!isWrappable(child)) return undefined;
      wrap(child, t, key);
      ct = lookupTarget(child, t.fam) ?? (child as any)[$TARGET];
    }
    return ct;
  };
  const walkT = (t: StoreTarget): void => {
    if (t.fam !== null) pullFamily(t);
    const src = enumerationSource(t);
    if (visited.has(src)) return;
    visited.add(src);
    readNode(getDeepNode(t));
    // Through a chain (#3323): every inner record's container AND deep
    // witness — base writes bump the inner witnesses.
    for (let it = t; it.ch; ) {
      it = (it.v as any)[$TARGET];
      readNode(getContainerNode(it));
      readNode(getDeepNode(it));
    }
    for (const key of visibleKeys(t, src)) {
      const desc = visibleDescriptor(t, src, key);
      if (desc === undefined) continue;
      if (desc.get || desc.set) {
        t.a = true;
        continue; // accessors track through their own reads when invoked
      }
      let child = desc.value;
      if (child === null || typeof child !== "object") continue;
      if (t.ch && (child as any)[$TARGET] === undefined) child = resolveChainedRaw(t, key, child);
      const ct = childTarget(t, child, key);
      if (ct === undefined) continue; // raw-marked: leaf by contract
      walkT(ct);
    }
  };
  walkT(t0);
  return snapshot(value);
}

/** Non-tracking snapshot: source identity for unowned subtrees (zero copy),
 * a copy for owned ones (they are by definition modified relative to the
 * source). Sees the pending backing (R27). */
export function snapshot<T>(value: T): T {
  const t: StoreTarget | undefined = (value as any)?.[$TARGET];
  return snapshotWalk(value, new Map(), t?.fam ?? null);
}

function snapshotWalk(value: any, seen: Map<object, any>, fam: StoreFamily | null): any {
  if (value === null || typeof value !== "object") return value;
  let src = value;
  for (let entry = true; ; entry = false) {
    const viaProxy = src?.[$TARGET]?.v !== undefined;
    let t: StoreTarget | undefined = viaProxy ? src[$TARGET] : undefined;
    if (t === undefined && fam !== null) t = lookupTarget(src, fam);
    if (t === undefined) t = lookupTarget(src, null);
    if (t === undefined) break;
    if (entry && !viaProxy && fam !== null && t.fam !== fam) {
      const outer = fam.map.get(t.px);
      if (outer !== undefined) t = outer;
    }
    if (t.fam !== null) fam = t.fam;
    // R27: a snapshot sees the batch's pending backing — a held one (another
    // transaction's future) only from its own draft.
    let backing = t.v;
    if (
      t.pb !== null &&
      (inDraft(t) || writeOverride || t.k === null || !(t.k._config & CONFIG_HELD))
    ) {
      if (t.ovl) materializePB(t);
      backing = t.pb!;
    }
    if (optRead(t)) backing = optHooks!.view(t, backing);
    if (backing === src) break;
    src = backing;
  }
  if (!isWrappable(src)) return src;
  const cached = seen.get(src);
  if (cached !== undefined) return cached;
  if (isOwned(src)) {
    const isArr = Array.isArray(src);
    const copy: any = isArr ? [] : Object.create(Object.getPrototypeOf(src));
    seen.set(src, copy);
    for (const key of Reflect.ownKeys(src)) {
      if ((isArr && key === "length") || key === $OWNER) continue;
      const desc = Object.getOwnPropertyDescriptor(src, key)!;
      if (typeof key === "symbol" && !desc.enumerable) continue;
      if (desc.get || desc.set) {
        Object.defineProperty(copy, key, desc);
        continue;
      }
      const cv = desc.value;
      const walked = cv !== null && typeof cv === "object" ? snapshotWalk(cv, seen, fam) : cv;
      if (desc.enumerable && desc.writable && desc.configurable) copy[key] = walked;
      else Object.defineProperty(copy, key, { ...desc, value: walked });
    }
    if (isArr && copy.length !== (src as any[]).length) copy.length = (src as any[]).length;
    return copy;
  }
  seen.set(src, src);
  let copy: any = null;
  for (const key of Reflect.ownKeys(src)) {
    const desc = Object.getOwnPropertyDescriptor(src, key);
    if (!desc || desc.get || desc.set) continue;
    const cv = desc.value;
    if (cv === null || typeof cv !== "object") continue;
    const walked = snapshotWalk(cv, seen, fam);
    if (walked !== cv) {
      if (copy === null) {
        copy = Array.isArray(src)
          ? [...(src as any[])]
          : Object.create(Object.getPrototypeOf(src), Object.getOwnPropertyDescriptors(src));
        seen.set(src, copy);
      }
      copy[key] = walked;
    }
  }
  return copy ?? src;
}
