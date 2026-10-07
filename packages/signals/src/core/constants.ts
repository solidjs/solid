export const REACTIVE_NONE = 0;
export const REACTIVE_CHECK = 1 << 0;
export const REACTIVE_DIRTY = 1 << 1;
export const REACTIVE_RECOMPUTING_DEPS = 1 << 2;
export const REACTIVE_IN_HEAP = 1 << 3;
export const REACTIVE_IN_HEAP_HEIGHT = 1 << 4;
/** L2 — the node sits on its owner's parked frame (`_x._pendingFirstChild`):
 * it is the displayed frame until the owner's commit disposes it. Set by
 * `markDisposal` over the parked subtree; carried through every per-pass
 * flag wipe (#3543). Scheduling reads it once, at the heap pop: a zombie's
 * recompute is deferred past the seam (`deferZombie`). */
export const REACTIVE_ZOMBIE = 1 << 5;
export const REACTIVE_DISPOSED = 1 << 6;
/** L2 — this pass read the future (a tracked read of a CONFIG_HELD node).
 * Lives for the pass only: set by `read`, consumed by `recompute`'s publish
 * (a first pass that read the future is born held, A29), wiped with the
 * pass's other per-pass bits. */
export const REACTIVE_JOINED = 1 << 7;
export const REACTIVE_SNAPSHOT_STALE = 1 << 8;
export const REACTIVE_LAZY = 1 << 9;
export const REACTIVE_MANUAL_WRITE = 1 << 10;
/** L2, rule 3 — the node's LAST pass was a render effect's read of the
 * future as committed (`frameRead`): the frame shows the committed world
 * beside a future it also derives from, and re-derives at the landing.
 * Survives its own pass's wipe; the next pass's wipe clears it (a pass that
 * re-derived the frame — in the future, or without the held read — owes the
 * landing nothing). The landing consumes it (the transaction's `_reruns`). */
export const REACTIVE_FRAME_READ = 1 << 11;
/**
 * A dependency write landed while this subscriber was mid-recompute — a
 * nested pull committed beneath one of its reads (#3037). The heap refuses
 * RECOMPUTING nodes, so recompute's tail consumes this latch and reschedules:
 * values the pass read before the nested commit are stale. Only set for
 * links validated this pass (gen-current): a write to an untouched link is
 * either re-read later in the pass (fresh) or trimmed with it (not a dep).
 */
export const REACTIVE_MISSED_WAKE = 1 << 12;
/** A `refresh()` asked this node to re-ask its question (A19 exc. 2, A24):
 * consumed by the next pass, which — going pending — classifies its flight
 * quiet (`_x._reask`). */
export const REACTIVE_REASK = 1 << 13;
/** The pass was served a node's ambient staging — written this flush, not
 * held. If the flush parks, the pass is the frame's with it (the same sync
 * frame as the async): a verdict read cannot break it out. Per pass. */
export const REACTIVE_STAGED_READ = 1 << 14;
/** The pass entered a verdict window (`isPending`/`latest`). Per pass: a
 * pass that did not keeps CONFIG_VERDICT no longer — the frame-reader
 * posture lasts exactly as long as the probing does. */
export const REACTIVE_PROBED = 1 << 15;
/** Lanes — the node (a lane's member) was dirtied by the lane's own
 * re-staging (a re-guess, lane work re-derived): its next pass is the
 * lane's from the start (`recompute`), not a stale reader's re-run by an
 * unrelated write (#3460). Consumed by the pass. */
export const REACTIVE_LANE_DIRTY = 1 << 16;
/** Lanes (plan sec. 28) — the pass read a lane's value as lane work (`enterLane`): a
 * tracked derivation's read of displayed optimism, a verdict read routed
 * into the holder's verdict lane. A pass in a lane's seat that read none of
 * its world has left the lane (`recompute`'s tail). Per pass. */
export const REACTIVE_LANE_READ = 1 << 17;
/** Lanes (plan sec. 28) — a render effect in the frame's seat was served the screen
 * for a lane's node (`laneRead`: a stale reader of a lane that has not
 * shown). Its pass computing exactly what it last applied has nothing to
 * run — an effect has no comparator, and the guess's notification is not a
 * change it can see. Per pass. */
export const REACTIVE_SCREEN_READ = 1 << 18;
/** A verdict reader whose probe was answered before the flush had a
 * transaction (verdict.ts `watchVerdict`): the seam re-runs it even if a
 * later read of the same pass routed it into a verdict lane — that was not
 * the probe's answer (lanes.ts). Per pass. */
export const REACTIVE_PROBE_UNANSWERED = 1 << 19;

// Static configuration bits packed into Owner/Computed/Signal _config.
/** The published frame ended in failure. The cause lives in the cold
 * extension; current computation status describes the proposed frame. */
export const CONFIG_COMMITTED_ERROR = 1 << 19;
/** The snapshot slot contains a failure rather than a successful payload. */
export const CONFIG_SNAPSHOT_ERROR = 1 << 20;
export const CONFIG_OWNED_WRITE = 1 << 0;
export const CONFIG_NO_SNAPSHOT = 1 << 1;
export const CONFIG_TRANSPARENT = 1 << 2;
export const CONFIG_IN_SNAPSHOT_SCOPE = 1 << 3;
export const CONFIG_CHILDREN_FORBIDDEN = 1 << 4;
export const CONFIG_AUTO_DISPOSE = 1 << 5;
export const CONFIG_SYNC = 1 << 6;
// CARVE 3: REACTIVE_ZOMBIE, CONFIG_AUTHORITATIVE_READ, CONFIG_DIRECT_COMMIT,
// CONFIG_HELD_CHILDREN, CONFIG_INPUTS_PUBLISHED and CONFIG_ADOPTED_UNFLUSHED
// (transaction holds, zombies, until()'s authoritative view) went with the
// transactions.
// L2 (step 2): three bits, all maintained by the node's commit.
/** The node has a pass awaiting commit: its live children (and `_disposal`)
 * are that pass's and were never shown — a re-pass tears them down on the
 * spot, while the frame parked on `_x._pendingFirstChild` keeps waiting for
 * the commit. Set by `recompute` when it queues the node. */
export const CONFIG_STAGED = 1 << 7;
/** The node's staged state is in the future: the flush that staged it
 * parked. A write to it, a tracked read of it by a derivation, or a pass
 * over a derivation holding it joins the future (the flush parks). Render
 * effects are the frame, not derivations (rule 3): reading it outside a
 * parking flush they see the committed value and hold nothing, and are
 * re-derived at the landing. Set at the park seam on every staged node. */
export const CONFIG_HELD = 1 << 8;
/** A15's reveal corollary (#3305): a commit published this flight's inputs
 * beneath it — the node was pending, nothing staged, when it committed — so
 * its committed value is torn against the visible frame. A render effect
 * revealing it cannot be a stale reader: it observes the flight (pends,
 * holds) instead of showing the pre-flight value. Outlives the flight that
 * earned it for as long as the node stays pending, and no longer: the
 * commit that lands a value clears it. */
export const CONFIG_INPUTS_PUBLISHED = 1 << 10;
/** Lanes (plan sec. 28) — the node has a lane's value (`_x._lane`): a written guess
 * (CONFIG_GUESS) or a lane pass's derivation of one. Its lane is
 * `_x._transaction`. The gate to the lane arm of `read`; `_value` stays the
 * committed truth and `_pendingValue` a transaction's staging throughout —
 * a value's world is where it lives, never a bit. */
export const CONFIG_OVERRIDE = 1 << 11;
/** A store slot node (`slotSignal`): a leaf, presence, container or deep
 * witness of a store target. One literal, no `_x` at birth; the last-one-out
 * sweep dispatches it to the store's shared release hook (graph.ts) instead
 * of a per-node `_unobserved` closure. */
export const CONFIG_SLOT_NODE = 1 << 12;
/** A store slot node whose staging is a USER setter's proposal, not its
 * derive's derivation (A34 (3)'s discriminator for derived stores — the
 * leaf twin of REACTIVE_MANUAL_WRITE). Set by the user setter, cleared by
 * the derive's own write to the key. */
export const CONFIG_MANUAL_WRITE = 1 << 18;
/** Lanes — the node carries a written guess (`optimisticWrite`): its own
 * source recomputing it, or a plain write landing on it, is the truth
 * (`supersede`). A lane's derived staging is not. */
export const CONFIG_GUESS = 1 << 13;
/** The node's pass read a verdict (`isPending`/`latest`): a dependency going
 * pending is a question for its next pass — the verdict changed — so the
 * propagation re-derives it instead of marking it pending (as a kept-tail
 * link does, A30). Set at the window, never cleared: a reader that stopped
 * asking re-derives once and goes pending through its own read. */
export const CONFIG_VERDICT = 1 << 14;
/** A dependency's status is a question for this node's pass, not a fact
 * about its current one: the propagation re-derives it instead of marking
 * it, for errors as for pending (as CONFIG_VERDICT). A boundary's output
 * (show the content, or the fallback) and its `on` node (boundaries.ts); a
 * promise over an expression (`resolve`/`until`, signals.ts: the pass reads
 * the error and rejects, or re-asks a pending source). */
export const CONFIG_REDERIVE = 1 << 15;
/** The reader wants the truth, not the lane's guess (`until`, signals.ts):
 * a read of displayed optimism serves the base the guess covers, makes the
 * pass no lane's, and the truth landing wakes it even when it confirms the
 * guess (the one case ordinary subscribers are not told — A17's silence). */
export const CONFIG_AUTHORITATIVE = 1 << 17;
// Presence bits (stage-3 hot-path monomorphism, DESIGN-PATCH-CHANNEL §11b):
// optional per-node slots (_overrideValue, _pendingSignal/_latestValueComputed,
// _snapshotValue, _optimisticLane) are NOT part of every node's hidden class —
// reading a missing property defeats V8's inline caches on the hottest write/
// notify loops. These bits live on the always-present `_config` so hot paths
// pay one monomorphic masked read and only touch the optional field when its
// installer flagged it. Bits are STICKY ("may be set") — the guarded field
// read remains authoritative.
export const CONFIG_HAS_SNAPSHOT = 1 << 9;
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
/** A28 (4): the node was written inside a recompute that ran OUTSIDE a flush
 * (a creation-time compute — boundary machinery, a mapArray's first run). Such
 * a write is promoted at that recompute's end: readers in the same block see
 * it. Cleared when the next flush begins; set only on that rare path. */
export const CONFIG_PROMOTED = 1 << 22;
/** Observe tiers only: the node is framework plumbing (the `solid-js/refresh`
 * HMR memo between a component's root and its body) — it has no name, is no
 * segment of any owner path, and the attribution engine records nothing about
 * it (creation, re-runs, checks) and does not count it toward another scope's
 * WIDE_SCOPE_DEPS or a write's engine-side HUGE_FAN_OUT, while the nodes it
 * owns stay fully observed.
 * Set from the internal `_plumbing` option at creation; never set in prod. */
export const CONFIG_PLUMBING = 1 << 25;
/** Observe tiers only: a framework scope wide by construction (`@solidjs/web`'s
 * insert child-resolution pass, which must track each row's resolved child) —
 * the attribution engine's WIDE_SCOPE_DEPS skips it; the always-on HUGE_FAN_IN
 * does not. Set from the internal `_wide` option at creation by dev builds only
 * (the observe artifact mangles the option name, as it does `_plumbing`). */
export const CONFIG_WIDE = 1 << 26;
/** Observe tiers only: a framework async node that supersedes its own flights
 * by design (`@solidjs/web/frames`' per-key slot-arg memo, re-run by every
 * re-shipped record while the arg is still pending) — the attribution
 * engine's ABANDONED_FLIGHTS skips it; its flight records and the feedback
 * fold's counts are unchanged. Set from the internal `_supersedes` option at
 * creation by dev builds only (the observe artifact mangles the option name,
 * as it does `_wide`). */
export const CONFIG_SUPERSEDES = 1 << 27;

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
