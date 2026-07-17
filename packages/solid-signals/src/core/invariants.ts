import {
  NOT_PENDING,
  unwrapOverride,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { assertInvariant } from "./dev.js";
import type { OptimisticLane } from "./lanes.js";
import type { Computed, Signal } from "./types.js";

/**
 * Test-mode invariant checks for the async/transition/lane machinery.
 * Catalog and rationale: packages/solid-signals/INTERNALS-ASYNC-STATE.md.
 *
 * These are implementation self-consistency checks, not semantic rules: a
 * violation means the reactive system contradicted itself.
 *
 * They are gated on `__TEST__` (not just `__DEV__`): the per-write Set
 * tracking and per-flush quiescence sweep are too expensive for shipped dev
 * builds and for benchmarks (they showed up as a 5-21% hit across the
 * CodSpeed suite when they ran under `__DEV__`). Call sites stay `__DEV__`
 * guarded so production tree-shakes the calls; each entry point here
 * early-returns unless `__TEST__` is set, so dev builds pay only a no-op
 * call. The test suite (vitest run) defines `__TEST__: true`; benchmark mode
 * defines `__TEST__: false`.
 */

type AnyNode = Signal<any> | Computed<any>;

// Plain signals carry no _flags; `undefined & N` is 0 (not disposed).
function isDisposed(node: AnyNode): boolean {
  return !!((node as Computed<any>)._flags & REACTIVE_DISPOSED);
}

/** Wired by core.ts at module init to avoid import cycles. */
export const InvariantHooks: {
  pendingProbeActive: (() => boolean) | null;
  /** Fresh oracle for what an isPending companion SHOULD read right now. */
  computePendingState: ((node: AnyNode) => boolean) | null;
} = { pendingProbeActive: null, computePendingState: null };

// INV-7: nodes that received a transition-held `_pendingValue`. A node still
// holding one at quiescence with no queued commit is a leak (#2827 class).
const heldPendingNodes = new Set<AnyNode>();

// INV-4: nodes that own isPending()/latest() companions, checked for
// companion coherence at quiescence (#2831 class).
const companionOwners = new Set<AnyNode>();

// INV-6: nodes that received an optimistic override. At quiescence every
// override must have reverted (overrides never outlive their transition).
const optimisticNodes = new Set<AnyNode>();

// INV-10: nodes that received an affects() mark. At quiescence every mark
// must have been released (the refcount balances — a leaked mark would hold
// a pending verdict forever; a double release would flip it early or wedge
// the count negative-as-truthy).
const affectsMarkedNodes = new Set<AnyNode>();

// (Former INV-8 hold-provenance tracking is gone with revert targets: every
// held `_pendingValue` is now a pending commit — there is only one kind.)
export function devTrackHeldPending(node: AnyNode): void {
  if (!__TEST__) return;
  heldPendingNodes.add(node);
}

export function devTrackCompanionOwner(node: AnyNode): void {
  if (!__TEST__) return;
  companionOwners.add(node);
}

export function devTrackOptimistic(node: AnyNode): void {
  if (!__TEST__) return;
  optimisticNodes.add(node);
}

export function devTrackAffects(node: AnyNode): void {
  if (!__TEST__) return;
  affectsMarkedNodes.add(node);
}

// INV-3: transition async blockers may only be registered from the queue
// notification path (see .cursor/rules/async-registration-invariants.mdc).
// The transition's reporter map is dev-checked: writes outside an
// `allowAsyncReporterWrites` window assert.
let asyncReporterWritesAllowed = false;

/**
 * Open/close the sanctioned registration window. Call sites are `__DEV__`
 * guarded (no prod cost); the code inside the window must not throw.
 */
export function beginAsyncReporterWrites(): void {
  asyncReporterWritesAllowed = true;
}

export function endAsyncReporterWrites(): void {
  asyncReporterWritesAllowed = false;
}

class CheckedReportersMap extends Map<Computed<any>, Set<Computed<any>>> {
  set(key: Computed<any>, value: Set<Computed<any>>): this {
    assertInvariant(
      asyncReporterWritesAllowed,
      "INV-3",
      "transition._asyncReporters written outside the queue notification path — async blockers must only register from render-effect notification"
    );
    return super.set(key, value);
  }
}

export function createAsyncReporters(): Map<Computed<any>, Set<Computed<any>>> {
  return __TEST__ ? new CheckedReportersMap() : new Map();
}

/**
 * INV-2: a node with an *active* override must be registered for reversion in
 * the queue's or a transition's `_optimisticNodes`. An unregistered active
 * override would survive transition completion forever. Runs at the end of
 * every flush (not just quiescence — the invariant holds mid-transition).
 * (There is no revert-target requirement: authoritative values commit
 * silently into `_value` under the override mask — A17 — so reverting is
 * just dropping the override.)
 */
export function devCheckActiveOverrides(isRegisteredForRevert: (node: AnyNode) => boolean): void {
  if (!__TEST__) return;
  for (const node of optimisticNodes) {
    if (isDisposed(node)) {
      optimisticNodes.delete(node);
      continue;
    }
    if (node._overrideValue === undefined || node._overrideValue === NOT_PENDING) continue;
    assertInvariant(
      isRegisteredForRevert(node),
      "INV-2",
      "a node has an active optimistic override but is not registered in any _optimisticNodes list — the override can never revert"
    );
  }
}

/** INV-1: an isPending() probe must never leak past its own call. */
export function devCheckFlushStart(): void {
  if (!__TEST__) return;
  assertInvariant(
    !InvariantHooks.pendingProbeActive?.(),
    "INV-1",
    "pendingProbe is set at flush start — an isPending() probe leaked (missing restore in a throw path?)"
  );
}

/** INV-5: a merged lane's work moved to its root on merge and must stay empty. */
export function devCheckMergedLaneEmpty(lane: OptimisticLane): void {
  if (!__TEST__ || !lane._mergedInto) return;
  assertInvariant(
    lane._pendingAsync.size === 0 &&
      lane._effectQueues[0].length === 0 &&
      lane._effectQueues[1].length === 0,
    "INV-5",
    "a merged (non-root) lane accumulated pendingAsync/effects — work was routed past findLane()"
  );
}

/**
 * Companion-vs-oracle census (#2838 pre-work). A NON-ASSERTING diff logger:
 * at the end of every flush it compares each live companion's cached state
 * against a fresh oracle and logs every distinct divergence fingerprint once
 * (console, `[census]` prefix). Legit lane-scoped windows will show up too —
 * the census exists to enumerate the full taxonomy of mid-flight divergence
 * so the write-driven redesign knows every case it must produce, not to
 * judge them. Enabled only when the COMPANION_CENSUS env var is set (in
 * addition to `__TEST__`), so normal test runs pay one boolean check.
 */
const censusEnabled =
  typeof globalThis !== "undefined" && !!(globalThis as any).process?.env?.COMPANION_CENSUS;
const censusSeen = new Map<string, number>();

export function devCensusCompanions(isQueuedForCommit?: (node: AnyNode) => boolean): void {
  if (!__TEST__ || !censusEnabled) return;
  const oracle = InvariantHooks.computePendingState;
  if (!oracle) return;
  for (const node of companionOwners) {
    if (isDisposed(node)) continue;
    const comp = node as Computed<any>;
    const hasOverride = node._overrideValue !== undefined && node._overrideValue !== NOT_PENDING;
    const resting = node._overrideValue === NOT_PENDING;
    const held = node._pendingValue !== NOT_PENDING;
    // A held write already queued in the global commit queue lands on the
    // next flush; probes inside this one-flush window observe the fresh
    // value, so the A10 pair rule mutes the verdict for them — the
    // companion/oracle disagreement is unobservable, not a divergence.
    if (held && isQueuedForCommit?.(node)) continue;
    const sp = !!(comp._statusFlags & STATUS_PENDING);
    const su = !!(comp._statusFlags & STATUS_UNINITIALIZED);
    const stateKey =
      `ov=${hasOverride ? "act" : resting ? "rest" : "none"}` +
      ` held=${+held} sp=${+sp} su=${+su}`;

    const pendingSignal = node._pendingSignal;
    if (pendingSignal) {
      // Compare what a read would actually observe (A17: an active override
      // IS the value), not the raw committed slot — mid-transition the
      // verdict legitimately lives in the companion's override.
      const cached =
        pendingSignal._overrideValue !== undefined && pendingSignal._overrideValue !== NOT_PENDING
          ? unwrapOverride(pendingSignal._overrideValue)
          : pendingSignal._value;
      const fresh = oracle(node);
      if (cached !== fresh) {
        censusRecord(`pending companion=${cached} oracle=${fresh} ${stateKey}`);
      }
    }
    const shadow = node._latestValueComputed;
    if (
      shadow &&
      !(shadow._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_DISPOSED)) &&
      // A never-initialized shadow (first read threw NotReady inside a probe)
      // has cached nothing that could be stale — the next pull computes it.
      !(shadow._statusFlags & STATUS_UNINITIALIZED)
    ) {
      // Latest-view oracle: override if active, else the held in-flight
      // value, else the committed value (A17/A20 read order) — on both sides.
      const expected = hasOverride
        ? unwrapOverride(node._overrideValue)
        : held
          ? node._pendingValue
          : node._value;
      const shadowOverride =
        shadow._overrideValue !== undefined && shadow._overrideValue !== NOT_PENDING;
      const shadowHeld = shadow._pendingValue !== NOT_PENDING;
      const effective = shadowOverride
        ? unwrapOverride(shadow._overrideValue)
        : shadowHeld
          ? shadow._pendingValue
          : shadow._value;
      if (!Object.is(effective, expected)) {
        const label =
          effective === undefined
            ? "undefined"
            : Object.is(effective, node._value)
              ? "committed"
              : "other-stale";
        censusRecord(
          `latest shadow=${label} (held=${+shadowHeld}) oracle-src=${hasOverride ? "override" : held ? "pendingValue" : "value"} ${stateKey}`
        );
      }
    }
  }
}

function censusRecord(key: string): void {
  const n = (censusSeen.get(key) || 0) + 1;
  censusSeen.set(key, n);
  // Log first occurrence and powers of two so hot fingerprints are visible
  // without flooding the output.
  if ((n & (n - 1)) === 0) console.log(`[census] x${n} ${key}`);
}

/**
 * Quiescence checks. Run only when the system is fully drained: nothing
 * scheduled, no active/stashed transitions, no live lanes. At that point no
 * transition-scoped state may survive, and the lazily-created companions must
 * agree with a fresh computation of their owner's state.
 */
export function devCheckQuiescent(isQueuedForCommit: (node: AnyNode) => boolean): void {
  if (!__TEST__) return;
  for (const node of heldPendingNodes) {
    if (isDisposed(node) || node._pendingValue === NOT_PENDING) {
      heldPendingNodes.delete(node);
      continue;
    }
    // Queued nodes commit on the next flush; everything else is unreachable.
    assertInvariant(
      isQueuedForCommit(node),
      "INV-7",
      "a node holds a _pendingValue at quiescence with no queued commit and no transition — the value can never commit (leak, #2827 class)"
    );
  }

  for (const node of optimisticNodes) {
    if (isDisposed(node)) {
      optimisticNodes.delete(node);
      continue;
    }
    assertInvariant(
      node._overrideValue === undefined || node._overrideValue === NOT_PENDING,
      "INV-6",
      "an optimistic override survived to quiescence — resolveOptimisticNodes missed the node (its transition completed without reverting it)"
    );
  }

  for (const node of affectsMarkedNodes) {
    if (isDisposed(node) || !node._affectsCount) {
      affectsMarkedNodes.delete(node);
      continue;
    }
    assertInvariant(
      false,
      "INV-10",
      "an affects() mark survived to quiescence — a registration was never released (leaked from its transaction) or the refcount went unbalanced"
    );
  }

  for (const node of companionOwners) {
    if (isDisposed(node)) {
      // Companions are created detached (context = null) so effect disposal
      // can't take them down; they die by GC with their owner. What must NOT
      // survive the owner is a phantom verdict: an isPending companion stuck
      // `true` for a disposed source would hold a spinner forever.
      assertInvariant(
        !node._pendingSignal || node._pendingSignal._value === false,
        "INV-9",
        "isPending companion reports true for a DISPOSED owner at quiescence — a stale verdict outlived its source"
      );
      companionOwners.delete(node);
      continue;
    }
    // Companion coherence is only asserted for *settled* owners (no async in
    // flight, no held pending value, no active override). The converse — what
    // the companion should read while async is in flight after its transition
    // already completed (pure signals graphs have no render-effect reporters,
    // so transitions complete immediately) — is a semantic question tracked in
    // INTERNALS-ASYNC-STATE.md §6, not a self-consistency invariant.
    const settled =
      !((node as Computed<any>)._statusFlags & STATUS_PENDING) &&
      node._pendingValue === NOT_PENDING &&
      (node._overrideValue === undefined || node._overrideValue === NOT_PENDING);
    if (!settled) continue;

    const pendingSignal = node._pendingSignal;
    if (pendingSignal) {
      assertInvariant(
        pendingSignal._value === false &&
          (pendingSignal._overrideValue === undefined ||
            pendingSignal._overrideValue === NOT_PENDING),
        "INV-4",
        "isPending companion reports pending for a fully settled node at quiescence — a clear path skipped updatePendingSignal (#2831 class)"
      );
    }
    const shadow = node._latestValueComputed;
    // Only check a settled shadow: a dirty/check-marked shadow legitimately
    // lags until its next lazy recompute.
    if (shadow && !(shadow._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_DISPOSED))) {
      assertInvariant(
        Object.is(shadow._value, node._value) || shadow._pendingValue !== NOT_PENDING,
        "INV-4",
        "latest() shadow computed holds a stale committed value for a settled node at quiescence — a write path skipped syncCompanions (#2831 class)"
      );
    }
  }
}
