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
  /** Retaining transactions (#3164 fold ruling): every transaction that made
   * an optimistic setter call on this family and may still be open. While
   * any member is live, truth landings FOLD — they stage into the retaining
   * transaction and reveal atomically at its settle, exactly like a signal
   * landing under an active override. Dead members prune lazily at each
   * landing (retainingTransition). */
  rt?: Set<any>;
  /** Normalized row-key fn (same resolution as the projection channels:
   * `options.key`, "id" default, null = unkeyed). The staged-landing walk
   * reads it: key-matched rows keep their proxy identity across a fold. */
  key?: ((item: any) => any) | null;
  map: WeakMap<object, StoreNextTarget>;
  /** The projection computed — assigned after creation (accessor pattern). */
  node: Computed<any> | null;
  shallow?: boolean;
}

/** Write-side patch-channel state (stage 2), grouped off the target's named
 * fields — see the shape rule on `StoreNextTarget.pc`. One literal shape,
 * allocated by `pcOf` on first use. */
/** One step of a manifested deep read path (see PatchChannel.dp): the key
 * to probe/descend under its parent object, plus child steps (null = leaf —
 * probing the key suffices, no descent needed). */
export interface DeepNode {
  k: string;
  c: DeepNode[] | null;
}

export interface PatchChannel {
  /** Slot-patch hooks for shallow arrays — the reconcile walk emits
   * (i, next, prev) for key-aligned value-replaced slots through the patch
   * apply queue (records are raw, no per-record targets exist).
   * MULTI-CONSUMER (external audit): one array can drive several lists. */
  sp: { fn: (index: number, next: any, prev: any) => void; owner: Owner | null }[] | null;
  /** Patch-channel consumers (next/patch.ts): per-record compiled patch
   * entries, multi-consumer. null when unpatched (the common case). */
  p: object[] | null;
  /** Node delivery: bare per-record version signal — bumped at the
   * emission seams, tracked by the channel's delivery effect. */
  dn: unknown;
  /** The detached delivery-effect NODE (round 10 shape cleanup): built by
   * the first consumer-visible bump, never disposed — persistence rule in
   * bumpOne. `undefined` doubles as the "never built" sentinel. */
  de?: object | undefined;
  /** Last dispatched bump count (the pure-registration flush skips). */
  dv?: number;
  /** Synchronous bump counter (dedup; the signal is pure notification). */
  bc?: number;
  /** Payload fast path: a self emission's fresh raw state, valid only
   * while `npb === bc` (any later bump or revert invalidates it). */
  np?: unknown;
  npb?: number;
  /** Deferred-demotion latch: a tentative getter-bearing view marked the
   * channel; the delivery effect consumes it in clean effect context.
   * Cleared with the consumers it belonged to (round 10, P2). */
  dmq?: boolean;
  /** Manifest-less consumer present (size pass): the accessed-key union is
   * unknowable — adoption/delivery probes full-scan instead of trusting a
   * partial `ak`. Replaces the drain-side recording proxy. Ref-counted by
   * `mlc` (round 10.9): released with the last manifest-less consumer. */
  akAll?: boolean;
  mlc?: number;
  /** Transaction-scoped dedup stamps (round 10.6): the transition that
   * last wrote the delivery signal — plain (`bt`) and optimistic (`bo`)
   * tracked separately (a held plain write is not lane-visible). Repeats
   * within one transaction skip the signal write; a different transaction
   * always writes (scheduler owns merge bookkeeping). */
  bt?: unknown;
  bo?: unknown;
  /** Structural VERSION (version-chain redesign): bumped at every
   * structural emission; items stamp `svAt`. Entries apply an item only on
   * an unbroken chain from their own applied version (`av === svAt - 1`) —
   * membership, holds, and ordering all reduce to version arithmetic. */
  sv?: number;
  /** VISIBLE structural version: the last emission whose effect an
   * untracked reader can see (bumped when items enter the LIVE queue —
   * commit-coincident emissions immediately, stashed ones at their
   * releaseBatch; lane emissions at emission). New entries initialize
   * `av` here: exactly what their first read covered. */
  svv?: number;
  /** Slot-channel twin of sv/svv (rows and slots are separate consumer
   * lists — one shared counter would gap every slot chain on row traffic). */
  svs?: number;
  svvs?: number;
  /** Accessed-key set for the channel's compiled bodies (union across
   * registrations). Compiler-manifested registrations (re-audit 7, P1-1)
   * hand the STATIC read envelope — complete across branches the applies
   * never took; runtime-recorded sets (manifest-less callers) cover only
   * executed reads. Adoption emission probes ONLY these keys for getters
   * (prod-sound demotion at bounded cost); null = not yet recorded, fall
   * back to the full scan. */
  ak: PropertyKey[] | null;
  /** DEEP read paths from compiler manifests (nested chains like
   * `row.queries.0.elapsed`) as a PREFIX TREE — shared prefixes probe once
   * (dbmon-shape manifests share one array root across ten leaves; flat
   * per-path probing was ~250 ms of a 20-round profile). Roots of the tree
   * are the SECOND path segments (first segments ride `ak`, probed against
   * the record itself). Probed against the incoming backing at adoption
   * gates and the live backing at forced applies — a getter at ANY step
   * demotes. Tree roots are FIRST path segments; their own getter probe
   * rides `ak` (every first segment is also a root key), so root nodes only
   * read + descend. null = no deep paths (the common case; one null
   * check). */
  dp: DeepNode[] | null;
  /** `ak`/`dp` are INTERNED manifest arrays shared across channels (copy-
   * on-write: ensureOwnedKeys clones before any union/record mutation). */
  ks: boolean;
  /** Owning target backref (merge coalescing resolves collided entries to
   * live-at-drain form). */
  t: unknown;
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
  /** Pending backing carries STAGED TRUTH (#3164 fold audit): an
   * optimistic-family draft written under the authoritative posture — a
   * landing staging into a retaining transaction. Its fold commits real
   * truth, so the structural channels emit for it (the optimistic-family
   * gates at the fold sites exist for OVERRIDE materializations, which
   * ride the lane). Cleared at the fold. */
  sf?: boolean;
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
  /** #3164 fold: does this live transaction still retain optimism (armed
   * nodes or tracked stores)? Backs the held-truth masks in next/store.ts so
   * plain-store bundles don't carry the transition-optimism probe. */
  retainsOptimism(t: any): boolean;
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
