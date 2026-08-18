/**
 * Store rewrite — target & ownership (INTERNALS-STORE-STATE.md §1, §5b).
 *
 * The proxy wraps this internal target, never the raw (proxy-target
 * indirection, decision 2026-08-16d). `b` is the single committed home; `pb`
 * is the per-target pending backing (RUL-1's pending home): the CoW clone
 * created at first draft write, mutated natively by the draft, folded into
 * `b` at flush commit. Adoption (setter replacement / reconcile) parks an
 * UNOWNED incoming object in `pb` — fold swaps it in and ownership resets.
 *
 * Creation budget (§5b): one minimal target + one proxy + one storeLookup
 * entry per read-through object; zero layer slots; nodes, has-nodes, and the
 * key-set node are lazy, materialized only by subscription.
 */
import type { Computed, Signal } from "../../core/types.js";

/** Projection family (§7b): children wrap into the family's own map (writes
 * land in the projection, never the source family), and every node created
 * under the family carries the projection computed as its firewall. */
export interface StoreNextFamily {
  /** Optimistic family: nodes are born armed (`_overrideValue` slot) so every
   * write rides the core optimistic engine — lanes, per-transaction ownership,
   * reverts all core-native (§3, RUL-3). */
  opt?: boolean;
  /** Root proxy (registered with the scheduler's optimistic-store set for the
   * transitionBlocked store-half, #2951). */
  px?: any;
  /** Targets currently carrying active node overrides (landing-consumption
   * walk, RUL-2: visible landed truth replaces optimism). */
  overlaid?: Set<any>;
  map: WeakMap<object, StoreNextTarget>;
  /** The projection computed — assigned after creation (accessor pattern). */
  node: Computed<any> | null;
  shallow?: boolean;
}

export interface StoreNextTarget {
  /** Committed backing: source object (shared) or owned clone. */
  v: Record<PropertyKey, any>;
  /** Pending backing for the current flush (null when settled). */
  pb: Record<PropertyKey, any> | null;
  /** cached: committed backing is another store's proxy (§7b chained). */
  ch: boolean;
  /** Lazy per-property subscription nodes (real core signals). */
  n: Record<PropertyKey, Signal<any>> | null;
  /** Lazy per-key presence nodes (`in` tracks presence, not value — R13). */
  h: Record<PropertyKey, Signal<boolean>> | null;
  /** Lazy key-set node: membership/iteration/$TRACK subscriptions (§6). */
  k: Signal<number> | null;
  /** Parent target (path copying walks this at commit). */
  u: StoreNextTarget | null;
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
  /** Accessor scan performed (scan-once on first trap read; adopted data is
   * not rescanned — legacy-parity behavior). */
  sc: boolean;
  /** Backing was swapped by adoption this batch (fold diff-notifies it). */
  adopted: boolean;
  /** Projection family, null for plain stores (§7b). */
  fam: StoreNextFamily | null;
  /** Shallow store root (values served raw). */
  s: boolean;
}

/**
 * Ownership (first cut, decision 2026-08-16d): one WeakSet of store-owned
 * backings serving both the production identity-skip guard and the __TEST__
 * no-mutation oracle.
 */
export const ownedRaw = new WeakSet<object>();

/** raw → target. The only raw-keyed lookup; boundary mechanism (O8). */
export const storeNextLookup = new WeakMap<object, StoreNextTarget>();

/** __TEST__ oracle: every object ingested from a user (never mutate). */
export const ingestedRaw: WeakSet<object> | null = __DEV__ ? new WeakSet<object>() : null;

export function devAssertNeverUserMutation(target: object): void {
  if (!__TEST__ || !ingestedRaw) return;
  if (ingestedRaw.has(target) && !ownedRaw.has(target)) {
    throw new Error(
      "[STORE-NEXT INV] write path mutated a user-provided (non-owned) object — CoW privatization was bypassed"
    );
  }
}
