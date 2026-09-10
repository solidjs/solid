import type { Transition } from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

/**
 * Observe-tier hook points for the reactive core.
 *
 * Core's obligation is to call these with true facts at the moments they
 * happen; ALL attribution semantics (stamps, cause chains, timings, warnings)
 * live in the engine that installs them — `@solidjs/signals/attribution`, a
 * separate entry so an observe build that never enables it never ships it
 * (same pattern as the GlobalQueue._* feature slots). `attrHooks` is null
 * unless an engine is installed, so the disabled cost is one null check per
 * site, and prod builds fold every site out behind __OBSERVE__.
 *
 * IMPORTANT for implementers of call sites: a hook call must never sit inside
 * a `try` block — rollup's tryCatchDeoptimization retains functions referenced
 * inside `try` even behind a folded __OBSERVE__ guard, which re-couples the
 * engine into prod bundles (#2883 harness). Set a local flag inside the try
 * and call the hook after the catch.
 */
export interface AttributionHooks {
  /**
   * `withInteraction` opened a user-interaction frame: root writes until the
   * matching `interactionEnd` were performed by the handler of `ref`. Frames
   * nest strictly (synchronous dispatch), so the engine keeps a stack.
   */
  interactionStart(ref: InteractionRef): void;
  interactionEnd(): void;
  /**
   * `withOrigin` opened a declared-origin frame: root writes until the
   * matching `originEnd` are the unit of work `ref` describes (a router's
   * navigation). Nests inside an interaction frame — a link click that
   * navigates — or stands alone (a redirect from an action, a programmatic
   * `navigate()`). Frames nest strictly, so the engine keeps a stack.
   */
  originStart(ref: OriginRef): void;
  originEnd(): void;
  /**
   * A `flush()` drain finished: every batch it processed either committed
   * (its effects have run) or was parked in a held transition (`holdStart`
   * fired for it). Fires once per drain, after the loop — not per batch, and
   * not for a `flush()` call that found nothing to do. Gives the engine the
   * "committed, screen updated" instant for writes no transition ever held.
   */
  flushEnd(): void;
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
  /**
   * A new async flight entered the system (`_inFlight` was just assigned
   * during a recompute of `el`). Always fired inside the owning recompute —
   * both call paths (core's recompute and the projection self-registration)
   * run within one — so the engine can read the current frame stack to link
   * the flight to the change that caused it (waterfall chaining). `flight`
   * is the registered thenable/iterable itself: the engine keys a first-seen
   * origin registry on its identity, so shared and preloader-marked promises
   * carry their true start time instead of the moment the graph saw them.
   */
  flightStart(el: Computed<any>, flight: object): void;
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
   * An effect's imperative half (its effect callback) is about to run /
   * has run. Both fire outside the run's try; `effectRunEnd` fires whether
   * or not the callback threw. Writes between the two are the effect's.
   */
  effectRunStart(el: Computed<any>): void;
  effectRunEnd(el: Computed<any>): void;
  /**
   * One synchronous step of an `action()` generator is about to run / has
   * run (`it.next()`/`it.throw()` up to the next yield). `it` is the
   * invocation's iterator — stable identity across its steps; `name` the
   * generator function's name. Writes between the two are the action's.
   */
  actionStepStart(it: object, name: string | undefined): void;
  actionStepEnd(it: object): void;
  /**
   * A flush found `t` incomplete (transitionComplete's false verdict): its
   * writes stay staged and its queues are about to be parked. Fired BEFORE
   * this flush's lane effects (the visible acknowledgers — isPending
   * companions, optimistic values) run; `holdEnd` fires from the root
   * stashQueues call after them, so effect runs between the two are runs that
   * painted *during* the hold.
   */
  holdStart(t: Transition): void;
  holdEnd(): void;
  /**
   * `t` was judged complete (transitionComplete's true verdict, before `_done`
   * flips). Fired before its held writes commit, so `t._pendingNodes` still
   * lists what was staged.
   */
  transitionSettled(t: Transition): void;
  /** `outgoing` was folded into `target` (`outgoing._done = target`). */
  transitionMerged(target: Transition, outgoing: Transition): void;
  /**
   * A store setter batch replaced the container at `path` (e.g. `store.user`)
   * with a different one (both non-null, same array-ness, not the same
   * logical slot), and this is the leaf census of the new container against
   * the old: `total` leaves (own keys, or items) in the new one, `unchanged`
   * of which are the same value as before (identity, judged on unwrapped
   * values — object keys compared by key, array items by membership), and
   * `prevTotal` leaves in the old one. Containers above 64 leaves are not
   * announced. Fired per written key from the write channel's notify. The
   * engine decides whether the replacement was a spread-copy worth a
   * diagnostic.
   */
  storeReplaced(
    path: string,
    isArray: boolean,
    total: number,
    unchanged: number,
    prevTotal: number
  ): void;
  /**
   * A `mapArray` update both disposed and created rows: `removed` are the
   * items whose rows were disposed, `created` the items that got new rows,
   * `newLen` the list's new length, `keyed` whether a key function is in use
   * (false = identity or by-index). Fired after commit. The engine judges
   * whether the churn replaced equivalent records (unstable identity).
   */
  listChurn(
    el: Computed<any>,
    removed: unknown[],
    created: unknown[],
    newLen: number,
    keyed: boolean
  ): void;
  /**
   * A loading boundary started (`shown` true) or stopped showing its
   * fallback. `boundary` is the boundary's queue (stable identity); `tree`
   * its bound subtree computed when already constructed — the first show can
   * fire while the subtree is still being built — whose owner chain names
   * the boundary. Fired at the source-set transitions (first pending source
   * registers / last one clears), not per flush.
   */
  boundaryFallback(boundary: object, tree: Computed<any> | undefined, shown: boolean): void;
}

/** A user interaction, as a rendering runtime describes it to `withInteraction`. */
export interface InteractionRef {
  /** Event type — `click`, `keydown`, `input`… */
  type: string;
  /** The element hit, e.g. `button#next "Next →"`. */
  target?: string;
  /** Dispatch time on the `performance.now()` clock; defaults to now. */
  at?: number;
}

/**
 * A navigation, as a router describes it to `withOrigin` around the location
 * write it is about to perform. Match eagerly and describe before writing:
 * the engine keys the work the write causes — the hold behind route data,
 * the re-runs, the verdicts — to this record, and names it by the
 * parametrized route so occurrences fold together.
 *
 * The engine keeps the object and reads `name`, `to` and `params` again when
 * the navigation settles (and when a hold on it is judged), so a router whose
 * match is not final at write time — a lazy route subtree that resolves inside
 * the hold — may describe coarsely (`/admin/*`) and assign the exact pattern
 * and params onto the same object once it knows them. `from` and `at` are
 * read once, when the frame opens.
 */
export interface NavigationRef {
  kind: "navigation";
  /** The matched route pattern — `/users/:id`. The name every consumer groups by. */
  name?: string;
  /** Concrete destination path. */
  to?: string;
  /** Concrete path being left. */
  from?: string;
  /** Route params the pattern bound — `{ id: "42" }` (optional params unbound: `undefined`). */
  params?: Readonly<Record<string, string | undefined>>;
  /**
   * When the navigation was requested on the `performance.now()` clock;
   * defaults to now. A router whose request predates the write (loaders
   * awaited before the location moves) passes its own start here.
   */
  at?: number;
  /**
   * `>= 1`: this frame is the Nth redirect hop of the navigation still
   * pending — a guard or loader sent it elsewhere before it landed — not a
   * new navigation. The engine folds it onto that pending record: the record
   * keeps the user's request time and interaction, its destination becomes
   * this one, and the abandoned destination is kept in `redirects`. Without
   * a pending navigation to fold onto it opens a navigation of its own.
   */
  redirect?: number;
}

/**
 * What `withOrigin` accepts: a declared unit of work whose writes the engine
 * should attribute as a whole. A discriminated union so kinds can be added
 * (a form submission, a tab switch) without the seam changing shape; the
 * engine knows `navigation` today.
 */
export type OriginRef = NavigationRef;

export let attrHooks: AttributionHooks | null = null;

export function setAttributionHooks(hooks: AttributionHooks | null): void {
  attrHooks = hooks;
}

/**
 * Run `fn` as the handler of a user interaction: every root write it performs
 * (and every action step, effect or flight the write causes) is attributed to
 * `ref` by whichever engine is installed. The web runtime wraps event
 * dispatch in this; custom renderers and test harnesses call it themselves.
 * With no engine installed it is `fn()` — the wiring, not the engine, so it
 * lives in core and is reachable as `OBSERVE.attribution.withInteraction`.
 *
 * The `finally` is deliberate and safe under the try rule above: this
 * function is referenced only from the `OBSERVE` object, which prod builds
 * fold to `undefined`, so nothing retains it there.
 */
export function withInteraction<T>(ref: InteractionRef, fn: () => T): T {
  // Pin the engine for the frame: a handler that disables it mid-way must
  // still close the frame it opened (the engine tolerates a close after
  // disable()), and one that enables it mid-way opened no frame to close.
  const hooks = attrHooks;
  if (hooks === null) return fn();
  hooks.interactionStart(ref);
  try {
    return fn();
  } finally {
    hooks.interactionEnd();
  }
}

/**
 * Run `fn` as a declared unit of work — a router's navigation: every root
 * write it performs is attributed to `ref` (and, through it, to the enclosing
 * interaction when there is one), so the hold those writes wait in, the
 * re-runs they cause and the verdicts on them all carry the route's name
 * instead of a bare signal's. Same contract as `withInteraction`: the wiring,
 * not the engine; `fn()` with no engine installed. Reachable as
 * `OBSERVE.attribution.withOrigin`.
 *
 * ```ts
 * OBSERVE
 *   ? OBSERVE.attribution.withOrigin(
 *       { kind: "navigation", name: match.pattern, to, from, params: match.params },
 *       () => setLocation(to)
 *     )
 *   : setLocation(to);
 * ```
 */
export function withOrigin<T>(ref: OriginRef, fn: () => T): T {
  const hooks = attrHooks;
  if (hooks === null) return fn();
  hooks.originStart(ref);
  try {
    return fn();
  } finally {
    hooks.originEnd();
  }
}
