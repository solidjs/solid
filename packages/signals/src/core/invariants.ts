import { NOT_PENDING, REACTIVE_DISPOSED } from "./constants.js";
import { assertInvariant } from "./dev.js";
import type { Computed, Signal } from "./types.js";

/**
 * Test-mode invariant checks for the async/transition/lane machinery.
 * Catalog and rationale: packages/signals/docs/INTERNALS-ASYNC-STATE.md.
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

// INV-7: nodes that received a transition-held `_pendingValue`. A node still
// holding one at quiescence with no queued commit is a leak (#2827 class).
const heldPendingNodes = new Set<AnyNode>();

// (Former INV-8 hold-provenance tracking is gone with revert targets: every
// held `_pendingValue` is now a pending commit — there is only one kind.)
export function devTrackHeldPending(node: AnyNode): void {
  if (!__TEST__) return;
  heldPendingNodes.add(node);
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
}
