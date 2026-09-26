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
 * flipped the awaited predicate truthy). Override-covered nodes never
 * arm: the override is their display and its revert their notification
 * (A17).
 *
 * To a DERIVING reader the truth is a staged value like any other: a memo
 * or user effect served it enters the transaction and is held with it
 * (A29), so a pass that composes it with a superseded override's truth
 * composes ONE staged world — never staged truth beside committed
 * neighbours (#3568: the mask served the retaining transaction's own pass
 * the landed `length` through the override while the rows past it stayed
 * committed, and `<For>` walked into a hole). Stale readers of a foreign
 * transaction keep committed through the stale-of-foreign clause,
 * untracked reads keep committed (Rule 1), and latest() and until()'s
 * predicate tunnel through — the exemption that keeps holds deadlock-free.
 *
 * The one reader the mark gates is a LANE pass, owning transaction or not
 * (ruled 2026-09-22, superseding #3589's owner exemption): a lane applies
 * its frame display-ahead at the park, so a lane pass served the truth
 * would paint the confirmation beside the optimism it confirms —
 * `saving=true` beside the saved row, a frame no timeline contains
 * (GabbeV's union tear). It keeps committed and is re-run by the reveal's
 * post-revert wake. A lane under the retaining transaction owns its
 * overrides and its lane cargo (`ownsLane`), not the transaction's
 * confirming truth. Cleared at commit (the commit IS the reveal);
 * subscribers masked during the hold are woken by finalizePureQueue's
 * post-revert pass. */
export const CONFIG_HELD_TRUTH = 1 << 17;
/** SLOT node (store leaf): created through `slotSignal` with `_host`/`_key`
 * backrefs baked into the literal. The unobserved sweep dispatches these to
 * the ONE shared hook (`setSlotUnobserved`) instead of a per-node closure
 * held in a per-node extension — store mounts materialize one signal per
 * touched leaf, so per-node allocations (options object, equals closure,
 * unobserved closure, NodeExtension) were the measured create-floor bytes
 * (warm dbmon profile: store node machinery ~36% + GC ~29%). */
export const CONFIG_SLOT_NODE = 1 << 18;

/** Optimistic node whose own source arrived with a value DIFFERENT from its
 * active override (A18 supersession, #3331). The override survives only as
 * the displayed value — untracked reads and the applied frame keep it until
 * the owning transaction commits — while the graph has already moved to the
 * staged truth in `_pendingValue`: tracked readers see it and the corrected
 * cascade is that transaction's held work. Set by the two own-source write
 * paths (asyncWrite, transition-held recompute); cleared by a fresh optimistic
 * write (a new override re-masks) and by the revert. */
export const CONFIG_OVERRIDE_SUPERSEDED = 1 << 19;

/** HELD children (#3404): this node's `_firstChild` chain (and `_disposal`
 * list) was built by a recompute whose result has not committed — a staged
 * value, a pending window, or a run under a held transaction. A later
 * recompute may tear those children down immediately: nothing observable
 * was ever built on them. Unset, the children belong to the committed frame
 * and a recompute defers them as zombies (`_pendingFirstChild`) until this
 * node commits — regardless of whether the recompute runs under a
 * transaction. A parked node (status propagation stamps `_transition`
 * without recomputing) recomputed when its source lands otherwise disposed
 * its committed children mid-hold, running their cleanups before the
 * transaction's atomic reveal. Cleared by `commitPendingNode`. */
export const CONFIG_HELD_CHILDREN = 1 << 20;

/** The frame parked in `_pendingFirstChild` / `_pendingDisposal` is a LANE
 * frame (#3662, A15 lanes corollary): an effect's lane pass direct-commits,
 * so the frame it replaces leaves the screen when the effect's RUN applies
 * (A30, the #3438 point) — not at the action's commit like #3404's
 * transaction zombies, and not at the pass (a held lane defers the run).
 * Drained by `runEffect`, by `commitPendingNode` if a hold stashed the run,
 * or with the owner's death. While set the parked frame is not a hold (the
 * node is not queued or stamped for it), a superseding pass disposes the
 * never-shown live children on the spot, and a lane-channel dirty on a
 * member is cancelled (`laneZombie`). Effects only: a memo's lane pass
 * publishes an override (A17, #3479). */
export const CONFIG_LANE_FRAME = 1 << 26;

/** In-flight async node whose inputs were PUBLISHED while it was pending: a
 * batch or transaction committed with the node still `STATUS_PENDING` (an
 * unobserved flight, #3305), so the inputs are on screen and the node's
 * committed `_value` is stale against them. Governs read()'s reveal
 * carve-out: a stale (render) reader in some OTHER transaction may show a
 * foreign-held pending node's committed value — parallel transactions, no
 * entanglement — only while that value is coherent with the visible frame,
 * i.e. while the flight's inputs are themselves held (unpublished) and not
 * lane-revealed. Set by `commitPendingNodes`; cleared when the node next
 * enters pending fresh (a new flight from a settled state). */
export const CONFIG_INPUTS_PUBLISHED = 1 << 21;
/** A28 (4): the node was written inside a recompute that ran OUTSIDE a flush
 * (a creation-time compute — boundary machinery, a mapArray's first run). Such
 * a write is promoted at that recompute's end: readers in the same block see
 * it. Cleared when the next flush begins; set only on that rare path. */
export const CONFIG_PROMOTED = 1 << 22;
/** A28 for same-tick adoption: the node was staged outside a flush and then
 * adopted by a transaction (initTransition) before any flush carried the
 * staging — the stamp says "held", but nothing flushed is staged for it, so
 * on no channel is the write visible yet: `latest()` answers the committed
 * value, the verdict sees nothing pending (as the store's leaves already did
 * through their own selection). Cleared when the carrying flush re-stamps the
 * transaction's pending nodes (reassignPendingTransition). */
export const CONFIG_ADOPTED_UNFLUSHED = 1 << 24;
/** The node's active override is a DERIVED one: a lane pass published its
 * speculative result into the override slot instead of `_value` (lanes
 * stage — an optimistic derivation is an override, #3479). Its truth is not
 * `_value` but a recompute from its inputs' truth, so the body-end
 * supersession (`endOptimism`) and the authoritative-flight blockage
 * (`transitionBlocked`) skip it; the revert drops the override and re-derives
 * it (`resolveOptimisticNodes`). Cleared with the override. */
export const CONFIG_DERIVED_OVERRIDE = 1 << 23;
/** Observe tiers only: the node is framework plumbing (the `solid-js/refresh`
 * HMR memo between a component's root and its body) — it has no name, is no
 * segment of any owner path, and the attribution engine records nothing about
 * it (creation, re-runs, checks), while the nodes it owns stay fully observed.
 * Set from the internal `_plumbing` option at creation; never set in prod. */
export const CONFIG_PLUMBING = 1 << 25;

export const STATUS_NONE = 0;
export const STATUS_PENDING = 1 << 0;
export const STATUS_ERROR = 1 << 1;
export const STATUS_UNINITIALIZED = 1 << 2;

export const EFFECT_PURE = 0;
export const EFFECT_RENDER = 1;
export const EFFECT_USER = 2;
export const EFFECT_TRACKED = 3;
/** OR-ed into the `type` a lane passes to its effect runners: lane runs
 * apply ahead of their transaction and are exempt from ownership parking. */
export const LANE_RUN = 4;

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
