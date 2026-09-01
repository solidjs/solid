export const REACTIVE_NONE = 0;
export const REACTIVE_CHECK = 1 << 0;
export const REACTIVE_DIRTY = 1 << 1;
export const REACTIVE_RECOMPUTING_DEPS = 1 << 2;
export const REACTIVE_IN_HEAP = 1 << 3;
export const REACTIVE_IN_HEAP_HEIGHT = 1 << 4;
export const REACTIVE_ZOMBIE = 1 << 5;
export const REACTIVE_DISPOSED = 1 << 6;
export const REACTIVE_OPTIMISTIC_DIRTY = 1 << 7;
export const REACTIVE_SNAPSHOT_STALE = 1 << 8;
export const REACTIVE_LAZY = 1 << 9;
export const REACTIVE_MANUAL_WRITE = 1 << 10;
/**
 * The pending recompute is a re-ask of the same question: `refresh()` dirtied
 * the node while no tracked input changed value. Cleared whenever a real
 * value-change notification arrives (`insertSubs`), and consumed by
 * `recompute` into the node's `_reask` classification — a quiet (re-ask)
 * pending window does not read as pending (question-scoped pending model).
 */
export const REACTIVE_REASK = 1 << 11;
/**
 * A dependency write landed while this subscriber was mid-recompute — a
 * nested pull committed beneath one of its reads (#3037). The heap refuses
 * RECOMPUTING nodes, so recompute's tail consumes this latch and reschedules:
 * values the pass read before the nested commit are stale. Only set for
 * links validated this pass (gen-current): a write to an untouched link is
 * either re-read later in the pass (fresh) or trimmed with it (not a dep).
 */
export const REACTIVE_MISSED_WAKE = 1 << 12;

// Static configuration bits packed into Owner/Computed/Signal _config.
export const CONFIG_OWNED_WRITE = 1 << 0;
export const CONFIG_NO_SNAPSHOT = 1 << 1;
export const CONFIG_TRANSPARENT = 1 << 2;
export const CONFIG_IN_SNAPSHOT_SCOPE = 1 << 3;
export const CONFIG_CHILDREN_FORBIDDEN = 1 << 4;
export const CONFIG_AUTO_DISPOSE = 1 << 5;
export const CONFIG_SYNC = 1 << 6;
// Presence bits (stage-3 hot-path monomorphism, DESIGN-PATCH-CHANNEL §11b):
// optional per-node slots (_overrideValue, _pendingSignal/_latestValueComputed,
// _snapshotValue, _optimisticLane) are NOT part of every node's hidden class —
// reading a missing property defeats V8's inline caches on the hottest write/
// notify loops. These bits live on the always-present `_config` so hot paths
// pay one monomorphic masked read and only touch the optional field when its
// installer flagged it. Bits are STICKY ("may be set") — the guarded field
// read remains authoritative.
export const CONFIG_OPTIMISTIC = 1 << 7;
export const CONFIG_HAS_COMPANIONS = 1 << 8;
export const CONFIG_HAS_SNAPSHOT = 1 << 9;
export const CONFIG_HAS_LANE = 1 << 10;
/** Set on a FIREWALL computed when any of its child signals creates an
 * isPending()/latest() companion. Gates the post-recompute child-companion
 * walk (#3038): a store computed's `_child` chain holds one node per
 * materialized leaf, so walking it unconditionally makes every update cost
 * O(all leaves ever read). Sticky — set at companion creation, never
 * cleared; sync-only apps never set it and never pay the walk. */
export const CONFIG_CHILD_COMPANIONS = 1 << 11;
/** Set on a computed when its first firewall child signal is installed
 * (projection machinery). Gates markNode's firewall-children walk with one
 * masked read of the always-present _config — the walk's old `_child` read
 * moved into the cold extension (§12), and an unconditional `_x` deref per
 * marked node measurably taxed the propagation hot path (diamond -22%). */
export const CONFIG_FW_CHILDREN = 1 << 12;
/** Authoritative-view reader (`until()`): while this node computes, reads
 * dodge active optimistic OVERRIDES only — the predicate must observe
 * arriving truth, never the caller's own tentative writes (which would
 * trivially satisfy it). Everything else reads normally, INCLUDING
 * transition-staged `_pendingValue`: staged data is authoritative (optimism
 * lives only in override slots), and a hold that refused staged reads would
 * deadlock on data the open transaction itself is holding (a refresh the
 * action issued lands staged and cannot commit until the hold releases).
 * read() checks the bit on the reading computation (`context`) directly — no
 * ambient flag — so a shared computed the predicate pulls recomputes as
 * itself (no bit) under the normal view, and its cache never forks. */
export const CONFIG_AUTHORITATIVE_READ = 1 << 13;
/** Sticky mark: an authoritative-view reader read this node PAST an active
 * override. The ack shape — an authoritative arrival EQUAL to the override —
 * rides paths that are deliberately silent under A17 (every ordinary reader
 * sees the override, so an equal landing changes nothing for them). A marked
 * node notifies those readers on such paths anyway, so the landed truth is
 * seen without re-firing ordinary subscribers. Never cleared — only nodes an
 * until() predicate observed mid-override pay. */
export const CONFIG_AUTHORITATIVE_OBSERVED = 1 << 14;
/** Promise-delivery effect (resolve()/until()): commits its computed value
 * directly even when recomputing under its own held transition. These
 * effects deliver applies on a microtask (#2930) instead of the stashed
 * effect queues, so the value must ride the same immediate schedule — a
 * staged value with an immediate apply delivers stale state (resolve) or
 * deadlocks the hold (until). Safe because the node is a private leaf: no
 * subscriber reads an effect's value, only its own apply does. */
export const CONFIG_DIRECT_COMMIT = 1 << 15;
/** Fresh-pull reader (awaitable `refresh()`'s waiter effect): a read of a
 * dirty source recomputes it inline even when the height gate defers to the
 * flush. Closes the same-flush ordering race where a waiter created
 * alongside a refresh() mark read the PRE-re-ask value as settled and
 * delivered stale; with the pull, the waiter either parks on the re-ask's
 * pending window (async — woken by the settle walk, which runs on every
 * landing including equal-value ones) or serves its sync answer. resolve()
 * deliberately keeps that race — its contract is "first settled value"
 * (#2930), not "next quiescent state". */
export const CONFIG_FRESH_READ = 1 << 16;
/** HELD truth (#3164): this node's staged `_pendingValue` is confirming
 * truth riding a transaction that retains optimism, revealed only at that
 * transaction's settle. Two arming sites, one meaning: the store fold
 * (a landing staged into the retaining transaction) and until()'s
 * flip-entanglement (a foreign carrier's staged write, stolen when it
 * flipped the awaited predicate truthy). Until the reveal, ordinary
 * readers — lane and speculative recomputes included — keep committed:
 * the staging notified subscribers as a plain write, so without the mask
 * a mid-hold recompute composes live optimism with the confirming truth,
 * a frame no timeline contains (GabbeV's union tear). Authoritative
 * readers (until()'s predicate) and latest() tunnel through — the
 * exemption that keeps holds deadlock-free. Override-covered nodes never
 * arm: the override is their display and its revert their notification
 * (A17). Cleared at commit (the commit IS the reveal); subscribers masked
 * during the hold are woken by finalizePureQueue's post-revert pass. */
export const CONFIG_HELD_TRUTH = 1 << 17;

export const STATUS_NONE = 0;
export const STATUS_PENDING = 1 << 0;
export const STATUS_ERROR = 1 << 1;
export const STATUS_UNINITIALIZED = 1 << 2;

export const EFFECT_PURE = 0;
export const EFFECT_RENDER = 1;
export const EFFECT_USER = 2;
export const EFFECT_TRACKED = 3;

export const NOT_PENDING = {};
export const NO_SNAPSHOT = {};
/**
 * Stand-in stored in `_overrideValue` for an optimistic write of literal
 * `undefined` (#2898). The slot doubles as the optimistic-node brand
 * (`undefined` = not optimistic, `NOT_PENDING` = at rest), so the raw value
 * would erase the node's optimistic identity: the write turns invisible and
 * follow-up writes route off the optimistic path and commit permanently.
 * Same shape as NO_SNAPSHOT. Sites that surface the override VALUE unwrap
 * via `visibleOverrideValue`; slot identity tests stay raw.
 */
export const OVERRIDE_UNDEFINED = {};

/** Unwrap an active override's stored value for surfacing to readers (#2898). */
export function unwrapOverride<T = any>(v: unknown): T {
  return (v === OVERRIDE_UNDEFINED ? undefined : v) as T;
}
export const STORE_SNAPSHOT_PROPS = "sp";

export const SUPPORTS_PROXY = typeof Proxy === "function";

export const defaultContext = {};

/**
 * Brand symbol used by `Refreshable<T>` values (projection stores, async
 * memos) to expose their underlying computation to `refresh()`. Not part of
 * the user-facing API.
 *
 * @internal
 */
export const $REFRESH = Symbol("refresh");

/**
 * Brand applied to values that participate in the `refresh()` re-run protocol.
 * Accessors receive this handle internally; projected stores expose it through
 * their public return type so user-defined hooks that wrap `createOptimisticStore`
 * / `createProjection` / projection-form `createStore` can have their return
 * types inferred without leaking the internal `$REFRESH` symbol into public type
 * signatures (TS4058).
 */
export type Refreshable<T> = T & { readonly [$REFRESH]: any };
