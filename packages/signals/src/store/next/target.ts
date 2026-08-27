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
import type { Computed, Owner, Signal } from "../../core/types.js";

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

/** Write-side patch-channel state (stage 2), grouped off the target's named
 * fields — see the shape rule on `StoreNextTarget.pc`. One literal shape,
 * allocated by `pcOf` on first use. */
export interface PatchChannel {
  /** Slot-patch hooks for shallow arrays — the reconcile walk emits
   * (i, next, prev) for key-aligned value-replaced slots through the patch
   * apply queue (records are raw, no per-record targets exist).
   * MULTI-CONSUMER (external audit): one array can drive several lists. */
  sp: { fn: (index: number, next: any, prev: any) => void; owner: Owner | null }[] | null;
  /** Patch-channel consumers (next/patch.ts): per-record compiled patch
   * entries, multi-consumer. null when unpatched (the common case). */
  p: object[] | null;
  /** Same-batch coalescing stamp (re-audit 2, P2): the queue array this
   * channel last pushed a non-forced SELF entry into, plus the consumer-list
   * length at that push. A second identical emission into the same container
   * is an exact duplicate application (both capture the same live pb
   * reference and the same committed prev) and is skipped; container arrays
   * are per-batch so stale stamps mismatch naturally. */
  qa: unknown;
  ql: number;
  /** Row-ops consumers (next/patch.ts, PR-B): structural list ops —
   * (nextRows, { prefix, sources, removed }) at apply timing. */
  ro: object[] | null;
  /** Keys written through the traps since the last fold commit. Bounds the
   * setter notify/hold-check to O(written) instead of O(subscribed nodes) —
   * a record with thousands of per-key subscriptions (selection maps) would
   * otherwise pay a full node scan on every write. null = no trap writes
   * this batch (bulk paths fall back to the full scan). */
  wk: Set<PropertyKey> | null;
}

export interface StoreNextTarget {
  /** Committed backing: source object (shared) or owned clone. */
  v: Record<PropertyKey, any>;
  /** Pending backing for the current flush (null when settled). */
  pb: Record<PropertyKey, any> | null;
  /** cached: committed backing is another store's proxy (§7b chained). */
  ch: boolean;
  /** live value-node count (deleted-key sweep fast-out in the fused walk). */
  nc: number;
  /** Lazy per-property subscription nodes (real core signals). */
  n: Record<PropertyKey, Signal<any>> | null;
  /** Lazy per-key presence nodes (`in` tracks presence, not value — R13). */
  h: Record<PropertyKey, Signal<boolean>> | null;
  /** Lazy key-set node: membership/iteration/$TRACK subscriptions (§6). */
  k: Signal<number> | null;
  /** Patch-channel extension (lazily allocated on first use): groups the
   * write-side stage-2 fields so they never widen the TARGET's own named
   * field count. LOAD-BEARING SHAPE RULE: array proxy targets carry their
   * fields as named properties on a real array, and V8 normalizes an array
   * to dictionary properties as the named count grows (empirically at
   * counts ≡ 0 mod 3 from 18 up on V8 13.x) — every trap field read then
   * becomes a hash lookup (~15% uibench, tree suites worst). New
   * patch-channel state MUST go inside this object, not on the target. */
  pc: PatchChannel | null;
  /** Lazy deep-witness node: `deep()` subscribes ONE node per record instead
   * of one per path; write paths bump it only when it exists. Separate from
   * `k` so $TRACK/mapArray never rerun on leaf value changes (R9). */
  dk: Signal<number> | null;
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
  /** Pending backing is a prototype-chain OVERLAY of the committed backing
   * (`Object.create(v)` — own keys are this batch's writes, everything else
   * reads through). O(written) per flush instead of O(container) clones
   * (#3044); commit flattens own keys onto an owned committed backing in
   * place. Only plain-data non-array non-family containers qualify;
   * `materializePB` downgrades to the clone path when a consumer needs a
   * real container (reconcile, draft escape). */
  ovl: boolean;
  /** Keys deleted in the overlay window (a prototype overlay cannot shadow
   * a delete); null when none. */
  del: Set<PropertyKey> | null;
  /** Projection family, null for plain stores (§7b). */
  fam: StoreNextFamily | null;
  /** Shallow store root (values served raw). */
  s: boolean;
  /** Held committed view (#3074/#3075): the pre-hold committed backing,
   * served to committed-visibility readers while `ht` is live. Adoption is
   * eager by contract, but a projection recompute deriving from uncommitted
   * inputs (a transition-held source, or a latest()-pull ahead of the flush)
   * swaps the backing SPECULATIVELY — the old view must stay servable until
   * the hold resolves. */
  hv: Record<PropertyKey, any> | null;
  /** The holder for `hv`: a live transition (cleared lazily when it is done)
   * or the PLAIN_HOLD sentinel (a latest()-pull staging — cleared by the
   * fold commit). null = no hold. */
  ht: any;
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

/** Injection table for optimistic-only store machinery (next/optimistic.ts).
 * Every call site is gated on `fam?.opt`, and optimistic families can only
 * be created by createOptimisticStore — whose install populates this — so
 * the non-null assertions at the sites hold by construction. Keeping the
 * implementations out of next/store.ts lets plain-store bundles tree-shake
 * the optimistic channel entirely. */
export interface OptStoreHooks {
  notifyOptimisticWrites(t: any, pb: Record<PropertyKey, any>): void;
  optimisticView(t: any, src: Record<PropertyKey, any>): Record<PropertyKey, any>;
  applyTentative(t: any, incoming: any, keyFn: ((item: any) => any) | null): void;
}
export let optHooks: OptStoreHooks | null = null;
export function setOptHooks(h: OptStoreHooks): void {
  optHooks = h;
}

/** Sticky descendants flag walk (§6d): reconcile's keyed pruning descends
 * only where subscriptions exist at/below. Nodes AND patches count. */
export function markDescendants(target: StoreNextTarget): void {
  let t: StoreNextTarget | null = target;
  while (t && !t.d) {
    t.d = true;
    t = t.u;
  }
}
