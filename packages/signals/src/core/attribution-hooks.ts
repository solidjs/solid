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
   * The async landing finished. `direct` = the landing applies the value
   * itself (lane/override paths); false = it went through setSignal, whose
   * own `write` hook already saw any committed change. Fired whether or not
   * the landing committed — call sites cannot carry that fact out of their
   * try blocks (see the try rule above), so the engine derives committed-ness
   * from the node's state against its asyncStart snapshot.
   */
  asyncEnd(el: Computed<any>, prev: unknown, value: unknown, direct: boolean): void;
  /**
   * A patched store record's visibility transitioned. `dn` is the record's
   * delivery signal — the ONLY graph node its template consumers subscribe
   * to, so this is where cause chains for patch-applied DOM updates anchor.
   * Called AFTER the signal write (the engine's own `write` stamp carries a
   * meaningless counter transition; this re-stamp names the record and, for
   * self emissions (`withValues`), previews the record transition). `name`
   * is the record's store path ("store.rows.3"). Ancestor bubbles pass
   * `origin` — the ORIGINATING child's delivery signal (its fresh stamp
   * becomes the cause) or its path when the child has no channel — so
   * chains report the true write source, not the bubbled ancestor.
   */
  patchEmit(
    dn: Signal<any>,
    name: string,
    prev: unknown,
    next: unknown,
    withValues: boolean,
    origin?: Signal<any> | string | null
  ): void;
  /**
   * A patch-family channel is about to dispatch to `count` consumers.
   * The engine applies the SAME wide-write policy (threshold, doubling
   * memo, metadata) it applies to graph subscriber counts. `key` is the
   * memo identity (the delivery signal for value channels, the consumer
   * list for structural ones — which have no signal to stamp); `dn` when
   * present provides the record-path name.
   */
  patchDispatch(key: object, count: number, channel: string, dn: Signal<any> | null): void;
  /**
   * A COALESCED bump (pending-dedup absorbed the signal write) with a
   * different origin: append it to the pending stamp's causes so chains
   * report every child that fed the delivery, not just the first.
   */
  patchOrigin(dn: Signal<any>, origin: Signal<any> | string): void;
}

export let attrHooks: AttributionHooks | null = null;

export function setAttributionHooks(hooks: AttributionHooks | null): void {
  attrHooks = hooks;
}
