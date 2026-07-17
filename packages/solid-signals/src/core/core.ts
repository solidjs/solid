import { clearStatus, handleAsync, notifyStatus } from "./async.js";
import {
  $REFRESH,
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_NO_SNAPSHOT,
  CONFIG_OWNED_WRITE,
  CONFIG_SYNC,
  CONFIG_TRANSPARENT,
  defaultContext,
  EFFECT_TRACKED,
  EFFECT_USER,
  NO_SNAPSHOT,
  NOT_PENDING,
  OVERRIDE_UNDEFINED,
  unwrapOverride,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_LAZY,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_NONE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_REASK,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  STORE_SNAPSHOT_PROPS,
  type Refreshable
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { link, trimStaleDeps, unobserved } from "./graph.js";
import {
  deleteFromHeap,
  insertIntoHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode,
  queueFor
} from "./heap.js";
import { type OptimisticLane } from "./lanes.js";
import {
  clearSignals,
  DEV,
  emitDiagnostic,
  throwPendingUntrackedRead,
  warnStrictReadUntracked
} from "./dev.js";
import { devTrackHeldPending } from "./invariants.js";
import { cleanup, disposeChildren, inheritId, markDisposal } from "./owner.js";
import {
  activeAffectsMarks,
  activeTransition,
  armReaskClear,
  clock,
  dirtyQueue,
  globalQueue,
  GlobalQueue,
  insertSubs,
  projectionWriteActive,
  queuePendingNode,
  runInTransition,
  schedule,
  zombieQueue
} from "./scheduler.js";
import type { Computed, FirewallSignal, Link, NodeOptions, Owner, Root, Signal } from "./types.js";

GlobalQueue._update = recompute;
GlobalQueue._dispose = disposeChildren;

export const PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE =
  "[PRIMITIVE_IN_FORBIDDEN_SCOPE] Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope (component, computation) is not allowed. " +
  "Move the write outside or set the `ownedWrite` option if this is intentional.";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Calling refresh() inside an owned scope (component, computation) is not allowed. " +
  "Move the invalidation outside pure computation.";

export let tracking = false;
/** @internal verdict-module glue */
export function setPendingCheckActive(v: boolean): void {
  pendingCheckActive = v;
}
/** @internal verdict-module glue */
export function setLatestReadActive(v: boolean): void {
  latestReadActive = v;
}
/** @internal verdict-module glue */
export function setContextInternal(v: Owner | null): void {
  context = v;
}
export let stale = false;
export let pendingCheckActive = false;
export let latestReadActive = false;
export let context: Owner | null = null;
export let currentOptimisticLane: OptimisticLane | null = null;

/**
 * Marked sources read by the recompute currently on the stack (saved/restored
 * per recompute, like `context`). A computed that reads a node with a live
 * `affects()` mark inherits the mark's pendingness — `recompute` applies the
 * collected sources through `applyAffectsReads` after its commit, because the
 * `clearStatus` at the top of the commit path wipes whatever sentinel entries
 * the node held from the registration-time push. This is the pull half of
 * mark propagation (real async re-establishes itself by re-throwing on read;
 * marks are value-transparent, so they re-establish here instead).
 */
let affectsReads: (Signal<any> | Computed<any>)[] | null = null;

export let snapshotCaptureActive = false;
export let snapshotSources: Set<any> | null = null;

function ownerInSnapshotScope(owner: Owner | null): boolean {
  while (owner) {
    if (owner._snapshotScope) return true;
    owner = owner._parent;
  }
  return false;
}

export function setSnapshotCapture(active: boolean): void {
  snapshotCaptureActive = active;
  if (active && !snapshotSources) snapshotSources = new Set();
}

export function markSnapshotScope(owner: Owner): void {
  owner._snapshotScope = true;
}

export function releaseSnapshotScope(owner: Owner): void {
  owner._snapshotScope = false;
  releaseSubtree(owner);
  schedule();
}

function releaseSubtree(owner: Owner): void {
  let child = owner._firstChild;
  while (child) {
    if (child._snapshotScope) {
      child = child._nextSibling;
      continue;
    }
    if ((child as any)._fn) {
      const comp = child as Computed<any>;
      comp._config &= ~CONFIG_IN_SNAPSHOT_SCOPE;
      if (comp._flags & REACTIVE_SNAPSHOT_STALE) {
        comp._flags &= ~REACTIVE_SNAPSHOT_STALE;
        comp._flags |= REACTIVE_DIRTY;
        if (dirtyQueue._min > comp._height) dirtyQueue._min = comp._height;
        insertIntoHeap(comp, dirtyQueue);
      }
    }
    releaseSubtree(child);
    child = child._nextSibling;
  }
}

export function clearSnapshots(): void {
  if (snapshotSources) {
    for (const source of snapshotSources) {
      delete source._snapshotValue;
      delete source[STORE_SNAPSHOT_PROPS];
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}

export function recompute(el: Computed<any>, create: boolean = false): void {
  const isEffect = (el as any)._type;
  if (!create) {
    if (el._transition && (!isEffect || activeTransition) && activeTransition !== el._transition)
      globalQueue.initTransition(el._transition);
    deleteFromHeap(el, queueFor(el));
    el._inFlight = null;
    // Tracked effects run after finalizePureQueue, so dispose immediately instead of deferring
    if (el._transition || isEffect === EFFECT_TRACKED) disposeChildren(el);
    else if (el._firstChild !== null || el._disposal !== null) {
      markDisposal(el);
      el._pendingDisposal = el._disposal;
      el._pendingFirstChild = el._firstChild;
      el._disposal = null;
      el._firstChild = null;
      el._childCount = 0;
      if (__DEV__) clearSignals(el);
    } else if (__DEV__) clearSignals(el);
  }

  let isOptimisticDirty = !!(el._flags & REACTIVE_OPTIMISTIC_DIRTY);
  const hasOverride = el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING;
  const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);
  // Re-ask classification lives in the verdict module; capture the flag before
  // the recompute wipes _flags below.
  const hadReask = (el._flags & REACTIVE_REASK) !== 0;

  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._depGen++;
  el._flags = REACTIVE_RECOMPUTING_DEPS;
  el._time = clock;
  let value = el._pendingValue === NOT_PENDING ? el._value : el._pendingValue;
  let oldHeight = el._height;
  let prevTracking = tracking;
  const prevAffectsReads = affectsReads;
  affectsReads = null;
  let markedReads: (Signal<any> | Computed<any>)[] | null = null;
  let prevLane = currentOptimisticLane;
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = strictRead;
    strictRead = false;
  }
  tracking = true;
  // Lane posture lives with the engine: OPTIMISTIC_DIRTY is only ever set by
  // engine-driven paths, and _optimisticNodes is only pushed by
  // _optimisticWrite, so the hook is installed whenever either gate holds.
  if (isOptimisticDirty) {
    const lane = GlobalQueue._recomputeLane!(el, true);
    if (lane) currentOptimisticLane = lane;
  } else if (activeTransition && !create && activeTransition._optimisticNodes.length) {
    // Lane adoption: parent-deeper-than-owned-child can run before its OPT-dirty
    // child propagates. Walk deps once and inherit the OPT lane so this node
    // recomputes under the right posture and propagates correctly.
    const lane = GlobalQueue._recomputeLane!(el, false);
    if (lane) {
      isOptimisticDirty = true;
      currentOptimisticLane = lane;
    }
  }
  const isStaleEffect = isEffect && isEffect !== EFFECT_USER;
  const prevStale = stale;
  if (isStaleEffect) stale = true;
  try {
    if (!__DEV__ && el._config & CONFIG_SYNC) {
      value = el._fn(value);
      el._inFlight = null;
    } else {
      // Snapshot `_inFlight` so we can detect whether `_fn` self-registered an async
      // subscription (e.g. `createProjection` calls `handleAsync` from inside its body
      // with a setter callback). In that case, the outer `handleAsync` call below would
      // clobber the fresh subscription, so we skip it and let the internally-registered
      // iteration drive updates.
      const prevInFlight = el._inFlight;
      const fnResult = el._fn(value);
      const isAsyncResult = typeof fnResult === "object" && fnResult !== null;
      const inFlightChanged = el._inFlight !== prevInFlight;
      value = inFlightChanged || !isAsyncResult ? fnResult : handleAsync(el, fnResult);
      if (!inFlightChanged && !isAsyncResult) el._inFlight = null;
    }
    clearStatus(el, create);
    // _optimisticLane is only ever assigned by engine paths.
    if (el._optimisticLane) GlobalQueue._laneAsyncSettled!(el);
  } catch (e) {
    // Track pending async in the lane (not the lane's source — it creates the lane
    // but doesn't belong to it). Set lane BEFORE notifyStatus for downstream propagation.
    if (e instanceof NotReadyError && currentOptimisticLane) GlobalQueue._laneAsyncPending!(el);
    let reaskChanged = false;
    if (e instanceof NotReadyError) {
      el._blocked = true;
      if (GlobalQueue._applyReask !== null) reaskChanged = GlobalQueue._applyReask(el, hadReask);
    }
    notifyStatus(
      el,
      e instanceof NotReadyError ? STATUS_PENDING : STATUS_ERROR,
      e,
      undefined,
      e instanceof NotReadyError ? el._optimisticLane : undefined
    );
    if (reaskChanged) GlobalQueue._repollVerdicts!(el);
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
    if (isStaleEffect) stale = prevStale;
    el._flags = REACTIVE_NONE | (create ? el._flags & REACTIVE_SNAPSHOT_STALE : 0);
    context = oldcontext;
    markedReads = affectsReads;
    affectsReads = prevAffectsReads;
  }

  if (!el._error) {
    trimStaleDeps(el);
    const compareValue = hasOverride
      ? unwrapOverride(el._overrideValue)
      : el._pendingValue === NOT_PENDING
        ? el._value
        : el._pendingValue;
    let valueChanged = false;
    try {
      valueChanged =
        (!isEffect && wasUninitialized) || !el._equals || !el._equals(compareValue, value);
    } catch (e) {
      // A throwing user comparator is an error of this node's computation.
      // Route it through the same status path as a compute-phase throw so
      // error boundaries contain it; otherwise it unwinds the scheduler
      // flush, bypassing every boundary and wedging the queue (#2837).
      notifyStatus(el, STATUS_ERROR, e);
    }

    // Effects use `_equals: false` (no per-effect closure). The side effects that
    // the equals closure used to perform — flagging the effect dirty and enqueueing
    // its runner — happen here instead. `!create` matches the previous `initialized`
    // gate: the explicit recompute(node, true) inside effect() does not enqueue, so
    // effect() can call its runner synchronously for the first run.
    if (isEffect && valueChanged) {
      (el as any)._modified = !el._error;
      // Reuse one bound runner per effect — runEffect no-ops on a stale
      // `_modified`, so re-enqueueing the same function is harmless.
      if (!create)
        el._queue.enqueue(
          isEffect,
          ((el as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, el))
        );
    }

    if (el._error) {
      // Comparator threw: skip the commit — the node is now errored and the
      // status propagation above owns downstream notification.
    } else if (valueChanged) {
      const prevVisible = hasOverride ? el._overrideValue : undefined;

      if (create || (isEffect && activeTransition !== el._transition) || isOptimisticDirty) {
        el._value = value;
        // Lane-propagated correction: upstream data is fresh, correct the
        // override unconditionally. The direct _value commit is the lane's
        // own reveal schedule; drop any superseded older hold so its queued
        // commit can't clobber the fresh value.
        if (hasOverride && isOptimisticDirty) {
          el._overrideValue = value === undefined ? OVERRIDE_UNDEFINED : value;
          el._pendingValue = NOT_PENDING;
        }
      } else {
        el._pendingValue = value;
        if (__DEV__) devTrackHeldPending(el);
        // Transition-held sync recompute is a write path like setSignal/asyncWrite,
        // so sync derivations of held sources stay visible to isPending()/latest()
        // (#2831). Both companion writes are transition-scoped (optimistic) and
        // auto-revert/re-derive at commit. Skipped for plain flushes where the
        // pending value commits before effects run.
        if ((activeTransition || el._transition) && GlobalQueue._syncCompanions !== null)
          GlobalQueue._syncCompanions(el, value);
      }

      if (!hasOverride || isOptimisticDirty || el._overrideValue !== prevVisible)
        insertSubs(el, isOptimisticDirty || hasOverride);
    } else if (hasOverride) {
      // Unchanged value (equals the override) recomputed while the override
      // is active: _value may still be stale, so hold the authoritative value
      // for commit on its own transition's schedule — invisibly (A17/A18).
      if (el._pendingValue === NOT_PENDING) queuePendingNode(el);
      el._pendingValue = value;
      if (__DEV__) devTrackHeldPending(el);
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) {
        insertIntoHeapHeight(s._sub, queueFor(s._sub));
      }
    }
  }
  currentOptimisticLane = prevLane;
  // Marks read during this recompute re-attach after the commit above:
  // earlier, the sentinel's NotReadyError in `_error` would have routed the
  // fresh value into the error-skip branch instead of committing it. A real
  // (non-NotReady) error wins over marks (#2893): applying the sentinel here
  // would clobber the user's error with a NotReadyError from a node whose
  // reads value-transparency promises can never throw NotReady.
  // `markedReads` only collects under a live mark, so the hook is installed.
  if (markedReads && !(el._statusFlags & STATUS_ERROR))
    GlobalQueue._applyAffectsReads!(el, markedReads);
  // Mark-only pending doesn't queue (#2893): the node holds no value needing
  // a transition-scheduled commit, and queueing would stamp the marking
  // action's transaction onto it — freezing unrelated writes that share it.
  // (Single mask test up front keeps the mark-free hot path at original cost.)
  const pendFlags = el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED);
  const needsPendingCommit =
    el._pendingValue !== NOT_PENDING ||
    el._pendingFirstChild !== null ||
    el._pendingDisposal !== null ||
    (pendFlags !== 0 &&
      (pendFlags !== STATUS_PENDING ||
        activeAffectsMarks === 0 ||
        !GlobalQueue._onlyMarkPending!(el)));
  // Override-covered holds (hasOverride) always queue: their commit belongs
  // to their own transition's schedule (A18 re-rule) and is unobservable
  // under the override (A17). Revert no longer commits anything, so an
  // unqueued covered hold would leak (INV-7) once the revert clears
  // _transition.
  needsPendingCommit &&
    (!create || el._statusFlags & STATUS_PENDING) &&
    (!el._transition || hasOverride) &&
    queuePendingNode(el);
  el._transition &&
    isEffect &&
    activeTransition !== el._transition &&
    runInTransition(el._transition, () => recompute(el));
}

function updateIfNecessary(el: Computed<unknown>): void {
  if (el._flags & REACTIVE_CHECK) {
    for (let d = el._deps; d; d = d._nextDep) {
      const dep1 = d._dep;
      const dep = (dep1 as FirewallSignal<unknown>)._firewall || dep1;
      if ((dep as Computed<unknown>)._fn) {
        updateIfNecessary(dep);
      }
      if (el._flags & REACTIVE_DIRTY) {
        break;
      }
    }
  }

  if (
    el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY) ||
    (el._error && el._time < clock && !el._inFlight)
  ) {
    recompute(el);
  }

  el._flags = el._flags & (REACTIVE_SNAPSHOT_STALE | REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT);
}

export function computed<T>(fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T> {
  const transparent = options?.transparent ?? false;
  const self: Computed<T> = {
    id: inheritId(options, transparent, context),
    _config:
      (transparent ? CONFIG_TRANSPARENT : 0) |
      (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
      (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
      (options?.sync ? CONFIG_SYNC : 0) |
      (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
      (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
    _equals: options?.equals != null ? options.equals : isEqual,
    _unobserved: options?.unobserved,
    _disposal: null,
    _queue: context?._queue ?? globalQueue,
    _context: context?._context ?? defaultContext,
    _childCount: 0,
    _fn: fn,
    _value: undefined as T,
    _height: 0,
    _child: null,
    _nextHeap: undefined,
    _prevHeap: null as any,
    _deps: null,
    _depsTail: null,
    _depGen: 0,
    _subs: null,
    _subsTail: null,
    _parent: context,
    _nextSibling: null,
    _prevSibling: null,
    _firstChild: null,
    _flags: options?.lazy ? REACTIVE_LAZY : REACTIVE_NONE,
    _statusFlags: STATUS_UNINITIALIZED,
    _time: clock,
    _pendingValue: NOT_PENDING,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _inFlight: null,
    _transition: null,
    _reask: false
  } as Computed<T>;
  if (__DEV__) (self as any)._name = options?.name ?? "computed";
  setupComputedNode(self, options);
  return self;
}

/**
 * Build an Effect node with all effect-specific fields baked into a single object literal,
 * so V8 sees the full hidden class shape at construction time. Effects always run in lazy
 * mode (recompute is called explicitly by `effect()`), so we hardcode the lazy bits and skip
 * the auto-dispose CONFIG bit (effect() previously cleared it post-construction).
 */
export function createEffectNode<T>(
  fn: (prev?: T) => T,
  effectFn: (val: T, prev: T | undefined) => void | (() => void),
  errorFn: ((err: unknown, cleanup: () => void) => void | (() => void)) | undefined,
  type: number,
  notifyStatus: ((status?: number, error?: any) => void) | undefined,
  options: NodeOptions<T> | undefined
): any {
  const transparent = options?.transparent ?? false;
  const self = {
    id: inheritId(options, transparent, context),
    _config:
      (transparent ? CONFIG_TRANSPARENT : 0) |
      (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
      (options?.sync ? CONFIG_SYNC : 0) |
      (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
    _equals: false as unknown as Computed<T>["_equals"],
    _unobserved: options?.unobserved,
    _disposal: null,
    _queue: context?._queue ?? globalQueue,
    _context: context?._context ?? defaultContext,
    _childCount: 0,
    _fn: fn,
    _value: undefined as T,
    _height: 0,
    _child: null,
    _nextHeap: undefined,
    _prevHeap: null as any,
    _deps: null,
    _depsTail: null,
    _depGen: 0,
    _subs: null,
    _subsTail: null,
    _parent: context,
    _nextSibling: null,
    _prevSibling: null,
    _firstChild: null,
    _flags: REACTIVE_LAZY,
    _statusFlags: STATUS_UNINITIALIZED,
    _time: clock,
    _pendingValue: NOT_PENDING,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _inFlight: null,
    _transition: null,
    _reask: false,
    _modified: false,
    _prevValue: undefined as T | undefined,
    _effectFn: effectFn,
    _errorFn: errorFn,
    _cleanup: undefined as (() => void) | undefined,
    _type: type,
    _notifyStatus: notifyStatus
  } as any;
  if (__DEV__) self._name = options?.name ?? "effect";
  setupComputedNode(self, lazyOptions);
  return self;
}

const lazyOptions = { lazy: true } as const;

function setupComputedNode<T>(self: Computed<T>, options: NodeOptions<T> | undefined): void {
  self._prevHeap = self;
  const parent = (context as Root)?._root
    ? (context as Root)._parentComputed
    : (context as Computed<any> | null);
  if (__DEV__ && context && context._config & CONFIG_CHILDREN_FORBIDDEN) {
    emitDiagnostic({
      code: "PRIMITIVE_IN_FORBIDDEN_SCOPE",
      kind: "lifecycle",
      severity: "error",
      message: PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name
    });
    throw new Error(PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE);
  }
  if (context) {
    const lastChild = context._firstChild;
    if (lastChild === null) {
      context._firstChild = self;
    } else {
      self._nextSibling = lastChild;
      lastChild._prevSibling = self;
      context._firstChild = self;
    }
  }
  if (__DEV__) DEV.hooks.onOwner?.(self);
  if (parent) self._height = parent._height + 1;
  if (GlobalQueue._wireExternalSource !== null) GlobalQueue._wireExternalSource(self);
  !options?.lazy && recompute(self, true);
  if (snapshotCaptureActive && !options?.lazy) {
    if (!(self._statusFlags & STATUS_PENDING) && !(self._config & CONFIG_NO_SNAPSHOT)) {
      self._snapshotValue = self._value === undefined ? NO_SNAPSHOT : self._value;
      snapshotSources!.add(self);
    }
  }
}

export function signal<T>(v: T, options?: NodeOptions<T>): Signal<T>;
export function signal<T>(
  v: T,
  options?: NodeOptions<T>,
  firewall?: Computed<any>
): FirewallSignal<T>;
export function signal<T>(
  v: T,
  options?: NodeOptions<T>,
  firewall: Computed<unknown> | null = null
): Signal<T> {
  const s = {
    _equals: options?.equals != null ? options.equals : isEqual,
    _config:
      (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
      (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0),
    _unobserved: options?.unobserved,
    _value: v,
    _subs: null,
    _subsTail: null,
    _time: clock,
    _firewall: firewall,
    _nextChild: firewall?._child || null,
    _pendingValue: NOT_PENDING
  };
  if (__DEV__) {
    (s as any)._name = options?.name ?? "signal";
    (s as any)._internal = !!firewall;
  }
  firewall && (firewall._child = s as FirewallSignal<unknown>);
  if (
    snapshotCaptureActive &&
    !(s._config & CONFIG_NO_SNAPSHOT) &&
    !((firewall?._statusFlags ?? 0) & STATUS_PENDING)
  ) {
    (s as any)._snapshotValue = v === undefined ? NO_SNAPSHOT : v;
    snapshotSources!.add(s);
  }
  return s as Signal<T>;
}

export function optimisticSignal<T>(v: T, options?: NodeOptions<T>): Signal<T> {
  const s = signal(v, options);
  s._overrideValue = NOT_PENDING;
  return s;
}

export function optimisticComputed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T> {
  const c = computed(fn, options);
  c._overrideValue = NOT_PENDING;
  return c;
}

export function isEqual<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * When set to a component name string, any reactive read that is not inside a nested tracking
 * scope will log a dev-mode warning. Managed automatically by `untrack(fn, strictReadLabel)`.
 */
export let strictRead: string | false = false;
export function setStrictRead(v: string | false): string | false {
  const prev = strictRead;
  strictRead = v;
  return prev;
}

/**
 * Runs `fn` outside of any reactive tracking — reads inside `fn` will not
 * subscribe the current scope. Returns whatever `fn` returns.
 *
 * Use `untrack` inside a memo or effect when you need to read a signal once
 * without making the surrounding computation depend on its future changes.
 *
 * Pass a `strictReadLabel` string to enable a dev-mode warning: any reactive
 * read inside `fn` that isn't inside a nested tracking scope will log a
 * warning naming the label.
 *
 * @example
 * ```ts
 * createEffect(
 *   () => trigger(),                 // tracks `trigger` only
 *   () => {
 *     const snapshot = untrack(() => state); // read once, untracked
 *     log(snapshot);
 *   }
 * );
 * ```
 */
export function untrack<T>(fn: () => T, strictReadLabel?: string | false): T {
  if (
    GlobalQueue._externalUntrack === null &&
    !tracking &&
    (!__DEV__ || (!strictRead && !strictReadLabel))
  )
    return fn();
  const prevTracking = tracking;
  const prevStrictRead = strictRead;
  tracking = false;
  if (__DEV__) strictRead = strictReadLabel || false;
  try {
    if (GlobalQueue._externalUntrack !== null) return GlobalQueue._externalUntrack(fn);
    return fn();
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
  }
}

/**
 * Bring a computed to a readable state: lazy/disposed nodes are (re)computed;
 * an isPending() probe (`refresh`) additionally pulls the node fully up to
 * date so its status flags reflect the current graph.
 */
export function prepareComputed(comp: Computed<unknown>, refresh: boolean): void {
  if (comp._flags & REACTIVE_LAZY) {
    comp._flags &= ~REACTIVE_LAZY;
    recompute(comp as Computed<any>, true);
  } else if (comp._flags & REACTIVE_DISPOSED) {
    recompute(comp as Computed<any>, true);
  } else if (refresh) {
    updateIfNecessary(comp);
  }
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  // Handle latest() mode: read from _latestValueComputed
  // Checked before isPending so that isPending(() => latest(x)) checks
  // the _pendingSignal of _latestValueComputed (async in flight) rather
  // than the original node (which stays "pending" while held in a transition).
  if (latestReadActive) return GlobalQueue._latestRead!(el) as T;

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  const computed = el as Partial<Computed<unknown>>;
  const firewall = (el as FirewallSignal<any>)._firewall;
  const owner = firewall || el;

  // Handle isPending() mode: collect pending state while preserving normal read semantics.
  // Probe mode is suspended while preparing the node so nested reads during a
  // recompute don't collect into the probe.
  if (pendingCheckActive) {
    GlobalQueue._pendingCheck!(el, c as Computed<any> | null, owner as any, firewall);
  } else if (typeof computed._fn === "function") {
    prepareComputed(el as Computed<unknown>, false);
  }

  if (
    !computed._fn &&
    owner === el &&
    el._overrideValue === undefined &&
    el._snapshotValue === undefined &&
    activeTransition === null &&
    currentOptimisticLane === null &&
    !snapshotCaptureActive &&
    (!__DEV__ || !strictRead)
  ) {
    if (c && tracking) {
      link(el, c as Computed<any>);
      // A live mark on a read source flows to the reader (probe reads are
      // excluded: the probe's own collection owns that verdict, and marking
      // the enclosing memo would make an `isPending` wrapper itself pending).
      if (activeAffectsMarks !== 0 && el._affectsCount && !pendingCheckActive)
        (affectsReads ??= []).push(el);
    }
    return (!c || el._pendingValue === NOT_PENDING ? el._value : el._pendingValue) as T;
  }

  if (__DEV__ && strictRead && owner._statusFlags & STATUS_PENDING)
    throwPendingUntrackedRead(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });

  if (c && tracking) {
    link(el, c as Computed<any>, pendingCheckActive);
    // Mark inheritance through derivation (see the fast path above), and its
    // transitive half (#2893): a mark-pended owner's sentinel sources flow to
    // the reader like a direct mark — value-transparent reads have no throw
    // to re-establish through, so without this a mid-window recompute sheds
    // pendingness permanently past one derivation level.
    if (activeAffectsMarks !== 0 && !pendingCheckActive) {
      if (el._affectsCount) (affectsReads ??= []).push(el);
      if (owner._statusFlags & STATUS_PENDING)
        GlobalQueue._collectMarkSources!(owner as Computed<any>, (affectsReads ??= []));
    }

    if ((owner as Computed<unknown>)._fn) {
      const elQueue = queueFor(el as Computed<unknown>);
      if (owner._height >= elQueue._min) {
        markNode(c as Computed<any>);
        markHeap(elQueue);
        updateIfNecessary(owner);
      }
      const height = owner._height;
      // parent check is shallow, might need to be recursive
      if (height >= (c as Computed<any>)._height && (el as Computed<any>)._parent !== c) {
        (c as Computed<any>)._height = height + 1;
      }
    }
  }

  // Mark-only pending never suspends the reader (#2886): an affects() mark is
  // a promise of change, not an absence of value, so a derived node whose only
  // pending sources are mark sentinels keeps its real value readable —
  // pendingness reaches readers through verdicts (isPending), not throws.
  // (`activeAffectsMarks` gates the source scan off the mark-free hot path;
  // sentinels can't survive in pending sources past their last release.)
  if (
    owner._statusFlags & STATUS_PENDING &&
    !(activeAffectsMarks !== 0 && GlobalQueue._onlyMarkPending!(owner as Computed<any>))
  ) {
    if (c && !(stale && owner._transition && activeTransition !== owner._transition)) {
      if (__DEV__ && c && c._config & CONFIG_CHILDREN_FORBIDDEN) {
        const message =
          "[PENDING_ASYNC_FORBIDDEN_SCOPE] Reading a pending async value inside createTrackedEffect or onSettled will throw. " +
          "Use createEffect instead which supports async-aware reactivity.";
        emitDiagnostic({
          code: "PENDING_ASYNC_FORBIDDEN_SCOPE",
          kind: "async",
          severity: "warn",
          message,
          ownerId: c.id,
          ownerName: (c as any)._name,
          nodeName: (owner as any)?._name
        });
        console.warn(message);
      }
      // Per-lane suspension lives with the engine (a non-null lane implies it
      // is installed): under a lane, only same-lane pending async without an
      // active override throws.
      if (currentOptimisticLane === null || GlobalQueue._laneSuspends!(owner)) {
        if (!tracking && el !== c) link(el, c as Computed<any>);
        throw owner._error;
      }
    } else if (c && owner !== el && owner._statusFlags & STATUS_UNINITIALIZED) {
      if (!tracking && el !== c) link(el, c as Computed<any>);
      throw owner._error;
    } else if (!c && owner._statusFlags & STATUS_UNINITIALIZED) {
      throw owner._error;
    }
  }
  if ((el as Computed<any>)._fn && (el as Computed<any>)._statusFlags & STATUS_ERROR) {
    // Only a genuine reactive re-read may retry an errored async source:
    // - tracking: owned/tracked scope only (never events / `untrack` / effect side-effect phase)
    // - !pendingCheckActive: an `isPending` probe observes the error, never refetches
    // - el._time < clock: only on a later cycle than the one the error was found
    if (tracking && !pendingCheckActive && el._time < clock) {
      recompute(el as Computed<unknown>);
      return read(el);
    } else throw (el as Computed<any>)._error;
  }

  if (snapshotCaptureActive && c && (c as Computed<any>)._config & CONFIG_IN_SNAPSHOT_SCOPE) {
    const sv = el._snapshotValue;
    if (sv !== undefined) {
      const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
      const current = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (current !== snapshot) (c as Computed<any>)._flags |= REACTIVE_SNAPSHOT_STALE;
      return snapshot as T;
    }
  }

  if (__DEV__ && strictRead)
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });

  if (el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING) {
    // An active override means the engine is installed (A17: the override IS
    // the value for every reader — that check itself stays right here).
    if (c && stale && GlobalQueue._readStashed!(el as Signal<any>)) return el._value as T;
    return unwrapOverride<T>(el._overrideValue);
  }

  // Entanglement gate: a reader recomputing under an optimistic lane that reads
  // a pending mid-transition write sees the committed value. Projection-store
  // manual writes use the firewall's manual-write flag to opt into this path.
  // Async drivers are not under an optimistic lane and so bypass this, reading
  // _pendingValue for correct fetching. The sub is recorded for replay at commit
  // so it re-runs with the new committed view. (Gate details live with the
  // engine — a non-null lane implies it is installed.)
  if (
    currentOptimisticLane !== null &&
    activeTransition !== null &&
    c !== null &&
    GlobalQueue._gatedRead!(el as Signal<any>, owner, c as Computed<any>)
  ) {
    return el._value as T;
  }

  // In optimistic lane context, return _value for optimistic/lane-assigned signals
  // and for regular signals in stale mode (render effects). Non-stale readers (user
  // effects) see _pendingValue so that latest() and direct reads stay consistent.
  // (The lane-context clause lives with the engine.)
  const value =
    !c ||
    (currentOptimisticLane !== null &&
      GlobalQueue._laneReadsCommitted!(el, owner, c as Computed<any>)) ||
    el._pendingValue === NOT_PENDING ||
    (stale && el._transition && activeTransition !== el._transition)
      ? el._value
      : (el._pendingValue as T);
  // Record that this isPending() probe observed the fresh pending value, so
  // the probe doesn't pair "pending" with the new value (#2831).
  if (pendingCheckActive) GlobalQueue._recordFresh!(el, value);
  if (
    !c &&
    owner === el &&
    typeof computed._fn === "function" &&
    el._config & CONFIG_AUTO_DISPOSE &&
    !(owner._statusFlags & STATUS_PENDING) &&
    !el._subs
  ) {
    unobserved(el as Computed<unknown>);
  }
  return value;
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  if (
    __DEV__ &&
    !(el._config & CONFIG_OWNED_WRITE) &&
    !(context && context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    context &&
    (el as FirewallSignal<any>)._firewall !== context
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      nodeName: (el as any)._name,
      data: { operation: "setSignal" }
    });
    throw new Error(REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE);
  }

  if (el._transition && activeTransition !== el._transition)
    globalQueue.initTransition(el._transition);

  // The optimistic write path lives with the engine: only optimisticSignal /
  // optimisticComputed callers and optimistic store nodes carry an
  // _overrideValue slot, and every module that creates one installs the
  // engine first.
  if (el._overrideValue !== undefined && !projectionWriteActive)
    return GlobalQueue._optimisticWrite!(el, v);

  const currentValue = el._pendingValue === NOT_PENDING ? el._value : (el._pendingValue as T);

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  // Uninitialized check first: the first commit has no previous value, so the
  // user comparator must not run against `undefined` (matches recompute).
  const valueChanged =
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED) ||
    !el._equals ||
    !el._equals(currentValue, v);
  if (!valueChanged) return v;

  if (el._pendingValue === NOT_PENDING) queuePendingNode(el);
  el._pendingValue = v;
  if (__DEV__) devTrackHeldPending(el);

  GlobalQueue._syncCompanions !== null && GlobalQueue._syncCompanions(el, v);

  el._time = clock;
  insertSubs(el);
  schedule();
  return v;
}

/**
 * Suppresses automatic recomputation of `el` until the scheduler drains. Used
 * when a manual write should win over dependency changes queued in the same
 * tick. The MANUAL_WRITE flag is cleared by the pending-node drain; projection
 * computeds don't commit values, but they still need the same end-of-tick
 * cleanup point.
 */
export function suppressComputedRecompute(el: Computed<unknown>): void {
  deleteFromHeap(el, queueFor(el));
  if (!(el._flags & REACTIVE_MANUAL_WRITE) && el._pendingValue === NOT_PENDING) {
    queuePendingNode(el);
    schedule();
  }
  el._flags = (el._flags & ~(REACTIVE_DIRTY | REACTIVE_CHECK)) | REACTIVE_MANUAL_WRITE;
}

/**
 * User-facing setter for the memo form of `createSignal(fn)`. Behaves like
 * `setSignal`, but also cancels any pending recompute of the memo so the
 * manual value wins over a value that would otherwise be produced by an
 * upstream change in the same tick.
 */
export function setMemo<T>(el: Computed<T>, v: T | ((prev: T) => T)): T {
  const result = setSignal(el, v);
  suppressComputedRecompute(el as Computed<unknown>);
  return result;
}

/**
 * Executes `fn` with the given `owner` set as the current owner. Any reactive
 * primitives (`createSignal`, `createMemo`, `createEffect`, `onCleanup`,
 * `cleanup`, etc.) created inside `fn` are attached to that owner, so they
 * are disposed when the owner is disposed.
 *
 * The classic pattern: capture the current owner with `getOwner()` inside a
 * component, then re-enter it from a callback (event handler, async resolve,
 * setTimeout) so disposables created in the callback get cleaned up with the
 * component.
 *
 * @example
 * ```ts
 * function delayed<T>(ms: number, fn: () => T) {
 *   const owner = getOwner();
 *   setTimeout(() => runWithOwner(owner, fn), ms);
 * }
 * ```
 */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  if (__DEV__ && owner && (owner as any)._flags & REACTIVE_DISPOSED) {
    const message =
      "[RUN_WITH_DISPOSED_OWNER] runWithOwner called with a disposed owner. Children created inside will never be disposed.";
    emitDiagnostic({
      code: "RUN_WITH_DISPOSED_OWNER",
      kind: "owner",
      severity: "warn",
      message,
      ownerId: owner.id,
      ownerName: (owner as any)._name
    });
    console.warn(message);
  }
  const oldContext = context;
  const prevTracking = tracking;
  context = owner;
  tracking = false;
  try {
    return fn();
  } finally {
    context = oldContext;
    tracking = prevTracking;
  }
}

export function staleValues<T>(fn: () => T, set = true): T {
  const prevStale = stale;
  stale = set;
  try {
    return fn();
  } finally {
    stale = prevStale;
  }
}

/**
 * Invalidates one reactive source, forcing it to re-execute even if its inputs
 * haven't changed.
 *
 * Pass either a Solid-created accessor or a projected store created from
 * `createStore(fn, ...)` / `createProjection(...)`. `refresh()` is a
 * write-like invalidation operation: it does not read the target's value, and
 * refreshing a plain signal accessor is a no-op.
 *
 * Use it to invalidate cached async values (e.g. force a re-fetch) without
 * tearing the consumer down.
 *
 * @example
 * ```ts
 * const user = createMemo(async () => fetch(`/users/${id()}`).then(r => r.json()));
 *
 * // Re-fetch on demand
 * <button onClick={() => refresh(user)}>Reload</button>
 * ```
 */
export function refresh<T>(target: Refreshable<T>): void {
  const node = (target as any)?.[$REFRESH] as Computed<any> | undefined;
  if (!node) {
    if (__DEV__) {
      const message =
        "[INVALID_REFRESH_TARGET] refresh() expects a Solid source accessor or refreshable store. " +
        "Pass the original source target, not a wrapper function or derived property read.";
      emitDiagnostic({
        code: "INVALID_REFRESH_TARGET",
        kind: "write",
        severity: "error",
        message
      });
      throw new Error(message);
    }
    return;
  }
  if (
    __DEV__ &&
    context &&
    !((node._config ?? 0) & CONFIG_OWNED_WRITE) &&
    !(context._config & CONFIG_CHILDREN_FORBIDDEN)
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      nodeName: (node as any)._name,
      data: { operation: "refresh" }
    });
    throw new Error(REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE);
  }
  if (
    typeof node._fn === "function" &&
    !(node._flags & (REACTIVE_DISPOSED | REACTIVE_MANUAL_WRITE))
  ) {
    // A refresh with no value-change dirt already queued is a re-ask of the
    // same question: mark it so the recompute classifies any resulting
    // pending window as quiet (not pending). If the node is already dirty
    // from a real input change, the question changed — don't mark.
    // REACTIVE_IN_HEAP counts as dirt: insertSubs schedules subscribers by
    // heap insertion alone (no DIRTY/CHECK flag), so a same-batch value
    // change followed by refresh() must not be laundered into a quiet re-ask.
    if (!(node._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP))) {
      node._flags |= REACTIVE_REASK;
      armReaskClear();
    }
    node._flags = (node._flags & ~REACTIVE_CHECK) | REACTIVE_DIRTY;
    insertIntoHeap(node, queueFor(node));
    schedule();
  }
}
