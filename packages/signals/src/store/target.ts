/**
 * Store — target & ownership (INTERNALS-STORE-STATE.md §1, §5b; plan §31).
 *
 * The proxy wraps this internal target, never the raw. `v` is the single
 * committed home; the pending backing (`pb`) is the CoW overlay/clone the
 * draft mutates natively — and, on L2, the **container node's staging**
 * (§31.3, Q-A): `k` is the `$TRACK` node given a value. Its `_value` is the
 * committed backing, its `_pendingValue` the pending backing, so the
 * scheduler owns the backing's lifetime (park, commit, revert) and the store
 * keeps no fold ledger of its own. The fold at the flush's commit
 * (`_storeCommit`) is the one mutation of owned raw.
 *
 * Creation budget (§5b): one minimal target + one proxy + one lookup entry
 * per read-through object; nodes, presence nodes, the container node and
 * the deep witness are lazy — materialized by subscription, or (the
 * container) by the first write that needs to stage.
 */
import type { Computed, Owner, Signal } from "../core/types.js";

/** Projection family (§7b; returns in S3): children wrap into the family's
 * own map (writes land in the projection, never the source family), and the
 * family's node is the firewall every read through it pulls first. */
export interface StoreFamily {
  /** Optimistic family (S4): the setter's writes are guesses. */
  opt?: boolean;
  /** Targets carrying a lane value on one of their nodes (reads compose the
   * view over the truth — optimistic.ts); dropped lazily once none is. */
  overlaid?: Set<StoreTarget>;
  /** Normalized row-key fn (`options.key`, "id" default, null = unkeyed). */
  key?: ((item: any) => any) | null;
  map: WeakMap<object, StoreTarget>;
  /** The projection computed — the firewall. Assigned after creation. */
  node: Computed<any> | null;
  /** Targets of the family that carry nodes: the derive's pending wakes
   * their readers (A9) — the family's enumerable index, in place of a
   * per-leaf chain; a target leaves it with its last node. */
  live: Set<StoreTarget>;
  shallow?: boolean;
  /** Derive run counter (proj R37): the run whose draft is live. */
  run?: number;
}

export interface StoreTarget {
  /** Committed backing: source object (shared) or owned clone. */
  v: Record<PropertyKey, any>;
  /** Pending backing for the current batch (null when settled) — the same
   * object the container node stages (`k._pendingValue`). */
  pb: Record<PropertyKey, any> | null;
  /** cached: committed backing is another store's proxy (§7b chained). */
  ch: boolean;
  /** live value-node count (deleted-key sweep fast-out in the fused walk). */
  nc: number;
  /** Lazy per-property subscription nodes (slot nodes). */
  n: Record<PropertyKey, Signal<any>> | null;
  /** Lazy per-key presence nodes (`in` tracks presence, not value — R13). */
  h: Record<PropertyKey, Signal<boolean>> | null;
  /** Lazy CONTAINER node: membership/iteration/`$TRACK`/`length`
   * subscriptions (§6) and the backing's staging home (§31.3). */
  k: Signal<any> | null;
  /** Keys written through the traps since the last fold commit. Bounds the
   * setter notify/hold-check to O(written) instead of O(subscribed nodes) —
   * a record with thousands of per-key subscriptions (selection maps) would
   * otherwise pay a full node scan on every write. null = no trap writes
   * this batch (bulk paths fall back to the full scan); WK_ALL = bound
   * unusable (array length write). LOAD-BEARING SHAPE RULE: array proxy
   * targets carry their fields as named properties on a real array, and V8
   * normalizes an array to dictionary properties as the named count grows
   * (empirically at counts ≡ 0 mod 3 from 18 up on V8 13.x) — every trap
   * field read then becomes a hash lookup (~15% uibench, tree suites
   * worst). Future write-side state MUST ride an extension object, not new
   * named fields. */
  wk: Set<PropertyKey> | null;
  /** Lazy deep-witness node: `deep()` subscribes ONE node per record instead
   * of one per path; write paths bump it only when it exists. Separate from
   * `k` so $TRACK/mapArray never rerun on leaf value changes (R9). */
  dk: Signal<number> | null;
  /** Parent target (path copying walks this at commit). */
  u: StoreTarget | null;
  /** Property key of this target in the parent's backing. */
  pk: PropertyKey | null;
  /** The proxy for this target (stable outward identity). */
  px: any;
  /** Sticky descendants flag (§6d). */
  d: boolean;
  /** Sticky accessors-seen flag: an own accessor property was observed on
   * this target (first-read scan, defineProperty, or clone scan). Gates the
   * fold diff's descriptor-safe path and the get trap's descriptor path. */
  a: boolean;
  /** Accessor scan grade: 0 = not yet scanned (adoption resets — adopted data
   * is not rescanned until the next draft), 1 = scanned, 2 = scanned and
   * PLAIN DATA — `Object.prototype` with every own key an enumerable data
   * property. Grade 2 unlocks the spread clone (cloneRaw), bare-assignment
   * overlay writes and flatten (#3360); a non-plain defineProperty through
   * the draft downgrades it to 1. */
  sc: 0 | 1 | 2;
  /** Own-key count: exact at scan, then bumped by set-trap writes of keys new
   * to the container (never decremented — an estimate for the overlay/clone
   * choice only, #3360). */
  kc: number;
  /** Pending backing is a prototype-chain OVERLAY of the committed backing
   * (`Object.create(v)` — own keys are this batch's writes, everything else
   * reads through). O(written) per flush instead of O(container) clones
   * (#3044); commit flattens own keys onto an owned committed backing in
   * place. Plain-data non-array containers qualify; chained backings and
   * accessor containers keep the descriptor clone. `materializePB`
   * downgrades to the clone path when a consumer needs a real container
   * (draft escape). */
  ovl: boolean;
  /** Keys deleted in the overlay window (a prototype overlay cannot shadow
   * a delete); null when none. */
  del: Set<PropertyKey> | null;
  /** Projection family, null for plain stores (§7b). */
  fam: StoreFamily | null;
  /** Shallow store root (values served raw). */
  s: boolean;
}

/**
 * Ownership stamp (#3360): every backing the store ALLOCATES (CoW clones,
 * privatized committed backings) carries its owning target under this
 * enumerable symbol. One property write replaces the two weak-collection
 * registrations (ownership set + raw→target map) a fresh object used to pay
 * per draft — V8's identity-hash + ephemeron cost dominated the one-key
 * write floor. Enumerable so a spread copy (the plain-data clone path) stays
 * on the fast path and carries the stamp along.
 *
 * Owned backings are never user-reachable (`snapshot` copies them, the traps
 * hide the key), so every raw key walk in the store must skip `$OWNER`, and
 * ownership is answered by `isOwned` — a user object never carries it.
 * Overlay drafts (`Object.create(v)` over an owned `v`) inherit the stamp.
 */
export const $OWNER: unique symbol = Symbol(__DEV__ ? "STORE_OWNER" : 0);

/** raw → target for plain (family-less) stores. Family stores use their own
 * map so one raw can wrap once per family (§7b). */
export const storeLookup = new WeakMap<object, StoreTarget>();

export function isOwned(raw: object): boolean {
  return (raw as any)[$OWNER] !== undefined;
}

/** The target wrapping `raw` in `fam` (or the plain lookup). An owned raw
 * answers from its stamp; a user raw from the map. */
export function lookupTarget(raw: object, fam: StoreFamily | null): StoreTarget | undefined {
  const owner: StoreTarget | undefined = (raw as any)[$OWNER];
  return owner !== undefined && owner.fam === fam ? owner : (fam?.map ?? storeLookup).get(raw);
}

/** Test-tier oracle (INTERNALS §5): no write path ever mutates a
 * user-provided (non-owned) object. */
export const ingestedRaw: WeakSet<object> | null = __TEST__ ? new WeakSet<object>() : null;

export function devAssertNeverUserMutation(target: object): void {
  if (!__TEST__ || !ingestedRaw) return;
  if (ingestedRaw.has(target) && !isOwned(target)) {
    throw new Error(
      "store invariant: attempted mutation of a user-provided object (not store-owned)"
    );
  }
}

/** Sticky descendants flag up the parent chain (§6d): adoption descends
 * into a changed child pair only where a target with nodes exists below. */
export function markDescendants(target: StoreTarget): void {
  let t: StoreTarget | null = target;
  while (t && !t.d) {
    t.d = true;
    t = t.u;
  }
}

/** Observe tier: the owner in scope at `createStore` (attribution names and
 * owner paths); the `_owner` write never reaches the proxy. */
export const storeOwners: WeakMap<StoreTarget, Owner | null> | null = __OBSERVE__
  ? new WeakMap()
  : null;
