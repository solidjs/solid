import type { Computed, Signal } from "./types.js";

/**
 * Dev-only observability hook points for the reactive core.
 *
 * Core's obligation is to call these with true facts at the moments they
 * happen; ALL attribution semantics (stamps, cause chains, timings, warnings)
 * live in the engine that installs them (attribution.ts — same pattern as the
 * GlobalQueue._* feature slots). `attrHooks` is null unless an engine is
 * installed, so the disabled cost is one null check per site, and prod builds
 * fold every site out behind __DEV__.
 *
 * IMPORTANT for implementers of call sites: a hook call must never sit inside
 * a `try` block — rollup's tryCatchDeoptimization retains functions referenced
 * inside `try` even behind a folded __DEV__ guard, which re-couples the dev
 * engine into prod bundles (#2883 harness). Set a local flag inside the try
 * and call the hook after the catch.
 */
export interface AttributionHooks {
  /**
   * A recompute is starting; `el._deps` still holds the previous run's links.
   * Always paired with `recomputeEnd` (recompute has no early returns).
   */
  recomputeStart(el: Computed<any>, create: boolean): void;
  /**
   * The recompute finished. `changed` = committed a changed value (false for
   * errored runs); `optimistic` = ran under an optimistic lane / lane-dirty
   * posture; `transition` = a transition was active or owns this node;
   * `held` = the value went to `_pendingValue` (a transition hold) rather
   * than committing directly — its reveal happens later on the transition's
   * own schedule.
   */
  recomputeEnd(
    el: Computed<any>,
    create: boolean,
    changed: boolean,
    optimistic: boolean,
    transition: boolean,
    held: boolean
  ): void;
  /** A non-effect computed committed a changed value during a re-run. */
  derivedChanged(el: Computed<any>): void;
  /** A signal write committed (value passed the equality gate). */
  write(el: Signal<any> | Computed<any>, prev: unknown, value: unknown): void;
  /** refresh() invalidated this node (self-invalidation, no dep changed). */
  refreshed(el: Computed<any>): void;
  /** An async landing is about to apply its value (before any branch). */
  asyncStart(el: Computed<any>): void;
  /**
   * The async landing applied. `direct` = the value was committed by this
   * landing itself (lane/override paths); false = it went through setSignal,
   * whose own `write` hook already saw any committed change.
   */
  asyncEnd(el: Computed<any>, prev: unknown, value: unknown, direct: boolean): void;
}

export let attrHooks: AttributionHooks | null = null;

export function setAttributionHooks(hooks: AttributionHooks | null): void {
  attrHooks = hooks;
}
