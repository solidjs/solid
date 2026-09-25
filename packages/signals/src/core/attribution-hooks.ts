import type { ChangeOrigin } from "./attribution.js";
import type { Transition } from "./scheduler.js";
import type { Computed, Owner, Signal } from "./types.js";

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
 * The contract is internal: the built-in engine installs through
 * `setAttributionHooks`, and nothing public names this interface
 * (`OBSERVE.attribution.installed` exposes the installed table as an opaque
 * object). It becomes public surface again the day a second engine exists.
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
  /**
   * The handler returned. `returned` is its return value: a thenable means
   * the handler continues past this frame (`async () => { await … }`), and
   * the engine may keep the interaction's record open until it settles —
   * the wait the person experiences is that continuation, not the frame.
   */
  interactionEnd(returned?: unknown): void;
  /**
   * `withOrigin` opened a declared-origin frame: root writes until the
   * matching `originEnd` are the unit of work `ref` describes (a router's
   * navigation). Nests inside an interaction frame — a link click that
   * navigates — or stands alone (a redirect from an action, a programmatic
   * `navigate()`). Frames nest strictly, so the engine keeps a stack.
   */
  originStart(ref: NavigationRef): void;
  originEnd(): void;
  /**
   * A `flush()` drain is starting: work is scheduled or a transition is
   * active, so the loop will run at least once. Always paired with
   * `flushEnd` for the same drain, and never nested (`flush()` is a no-op
   * while the queue is running), so start → end is the wall time of one
   * drain — the scheduler's own span.
   */
  flushStart(): void;
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
   * Always paired with `recomputeEnd` (recompute's one early return — a node
   * disposed during its own pass, #3621 — fires it before leaving).
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
   * diagnostic. `owner` is the owner the store root was created under
   * (undefined when unrecorded): the finding is about the store, not about
   * whoever wrote it, so an `OBSERVE.exclude`d panel's store stays silent
   * however its writes arrive.
   */
  storeReplaced(
    path: string,
    isArray: boolean,
    total: number,
    unchanged: number,
    prevTotal: number,
    owner: Owner | null | undefined
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
   *
   * A show is the boundary's SWAP, a staged write: `transition` is the one
   * it lands with (`transitionSettled` is its display instant), or `null`
   * when this drain commits it (`flushEnd`) — the lane swap included, whose
   * readers run in this drain. A hide before that commit means the fallback
   * was never displayed — the content landed first and the sweep cleared the
   * swap ahead of the frame (#3540).
   */
  boundaryFallback(
    boundary: object,
    tree: Computed<any> | undefined,
    shown: boolean,
    transition?: Transition | null
  ): void;
  /**
   * An optimistic override the screen displayed is being replaced by a
   * different value. `"superseded"`: a new authoritative value landed that
   * differs from the guess (tracked readers re-derive to it). `"reverted"`:
   * nothing new landed and the guess lifts back to the committed value it
   * covered (the action failed, or never wrote what it promised). `shown`
   * is the override as displayed. Fired when the two differ by identity;
   * the engine applies the node's own equality before judging.
   */
  optimisticReverted(
    el: Signal<any> | Computed<any>,
    shown: unknown,
    truth: unknown,
    how: "superseded" | "reverted"
  ): void;
  /**
   * The one query on the surface: the provenance a root write performed at
   * this moment would be stamped with — the innermost open frame (an effect
   * callback, an action step, a navigation), the interaction the handler
   * runs under, or, inside a recompute, the origin of the change that caused
   * it — or `undefined` when none applies (external). For a runtime that
   * records a fact of its own beside the engine's records — `@solidjs/web`'s
   * `"call"` record stamps the server-function call it is about to make —
   * so the fact joins the engine's interaction and navigation records by the
   * identity of the object returned, not by time.
   */
  currentOrigin(): ChangeOrigin | undefined;
}

/** A user interaction, as a rendering runtime describes it to `withInteraction`. */
export interface InteractionRef {
  /** Event type — `click`, `keydown`, `input`… */
  type: string;
  /**
   * The element hit, e.g. `button#next "Next →"` — the tag, then `#id` or
   * `[name=…]`, then the element's text in quotes. Describe fully; the
   * engine keeps the quoted text as its `values` option allows (the
   * record's `target` is its own string, this one is never mutated).
   */
  target?: string;
  /** Dispatch time on the `performance.now()` clock; defaults to now. */
  at?: number;
}

/**
 * A navigation, as a router describes it to `withOrigin` around the location
 * write it is about to perform — what `withOrigin` accepts: a declared unit
 * of work whose writes the engine attributes as a whole, discriminated by
 * `kind` so another kind (a form submission, a tab switch) can join without
 * the seam changing shape; the engine knows `navigation` today. Match
 * eagerly and describe before writing: the engine keys the work the write
 * causes — the hold behind route data, the re-runs, the verdicts — to this
 * record, and names it by the parametrized route so occurrences fold
 * together.
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

export let attrHooks: AttributionHooks | null = null;

/**
 * The installed engine, registered on `globalThis` as well (the records
 * channel's reason, see `Records`): a wire layer bundled without a framework
 * import — `@solidjs/web`'s server-function client — stamps the records it
 * emits through the engine's `currentOrigin`, and this is its reach. The
 * module binding stays the core's own read (one null check per hook site);
 * the registration mirrors it.
 */
const INSTALLED = Symbol.for("@solidjs/signals/observe/attribution");

export function setAttributionHooks(hooks: AttributionHooks | null): void {
  attrHooks = hooks;
  (globalThis as { [INSTALLED]?: AttributionHooks })[INSTALLED] = hooks ?? undefined;
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
  let returned: T | undefined;
  try {
    return (returned = fn());
  } finally {
    hooks.interactionEnd(returned);
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
export function withOrigin<T>(ref: NavigationRef, fn: () => T): T {
  const hooks = attrHooks;
  if (hooks === null) return fn();
  hooks.originStart(ref);
  try {
    return fn();
  } finally {
    hooks.originEnd();
  }
}

/**
 * The provenance a root write performed now would carry, as the installed
 * engine sees it (`AttributionHooks.currentOrigin`); `undefined` with no
 * engine, or when nothing is in effect. Reachable as
 * `OBSERVE.attribution.currentOrigin` — how a runtime stamps a fact of its
 * own (a server-function call) with the interaction or navigation it ran
 * for, so an observer joins the two by identity.
 */
export function currentOrigin(): ChangeOrigin | undefined {
  const hooks = attrHooks;
  return hooks === null ? undefined : hooks.currentOrigin();
}
