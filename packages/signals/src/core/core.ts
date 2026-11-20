import { checkForeignRead, enterCopy, exitCopy } from "./copies.js";
import {
  clearInFlight,
  clearStatus,
  handleAsync,
  notifyStatus,
  parkLoadingWindow,
  releaseFlightTeardown,
  releaseIfSettledUnobserved,
  retryReaches,
  settleErroredDependents,
  settlePendingSource,
  stageError
} from "./async.js";
import {
  $REFRESH,
  CONFIG_ASYNC,
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_FRESH_READ,
  CONFIG_GUESS,
  CONFIG_VERDICT,
  CONFIG_HELD,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_MOUNT_AHEAD,
  CONFIG_OVERRIDE,
  CONFIG_HAS_SNAPSHOT,
  CONFIG_NO_SNAPSHOT,
  CONFIG_PLUMBING,
  CONFIG_WIDE,
  CONFIG_SUPERSEDES,
  CONFIG_SLOT_NODE,
  CONFIG_OWNED_WRITE,
  CONFIG_PROMOTED,
  CONFIG_STAGED,
  CONFIG_HELD_FRAME,
  CONFIG_LAGS,
  CAUGHT_REARMED,
  CONFIG_STAGED_ERROR,
  CONFIG_SYNC,
  CONFIG_TRANSPARENT,
  defaultContext,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NO_SNAPSHOT,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_OWNER_READS,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_IN_HEAP,
  REACTIVE_LANE_DIRTY,
  REACTIVE_LANE_READ,
  REACTIVE_PROBE_UNANSWERED,
  REACTIVE_SCREEN_READ,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_LAZY,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_MISSED_WAKE,
  REACTIVE_PROBED,
  REACTIVE_WINDOW,
  WINDOW_KINDS,
  REACTIVE_AHEAD,
  CONFIG_OWN_PROBE,
  CONFIG_FRAME,
  CONFIG_AHEAD,
  REACTIVE_REASK,
  REACTIVE_STAGED_READ,
  REACTIVE_NONE,
  REACTIVE_JOINED,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_RELEASE_AFTER,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_NONE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  EVENT_HANDLER_READ,
  type Refreshable,
  NewSet
} from "./constants.js";
import { NotReadyError } from "./error.js";
import {
  clearDeps,
  deferReleases,
  deferredReleases,
  dormantNodes,
  link,
  trimStaleDeps
} from "./graph.js";
import {
  deleteFromHeap,
  enqueueSub,
  insertIntoHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode,
  liftOwned
} from "./heap.js";
import {
  clearSignals,
  DEV,
  emitDiagnostic,
  asyncTailFlights,
  checkCaughtRead,
  checkPostAwaitRead,
  clearThrownRead,
  forgetThrownRead,
  GRAPH_SIZE_WARN_AT,
  noteFanIn,
  noteThrownRead,
  reportDiagnostic,
  throwPendingUntrackedRead,
  warnStrictReadUntracked
} from "./dev.js";
import { attrHooks } from "./attribution-hooks.js";
import { devTrackHeldPending } from "./invariants.js";
import { cleanup, disposeChildren, inheritId, linkChild, markDisposal } from "./owner.js";
// Reader-seat shadow: `__TEST__` only (documentation/archive/plans/reader-seat-rebuild.md §3).
import {
  RAISE_FL,
  RAISE_H,
  SLOT_C,
  SLOT_E,
  SLOT_NONE,
  SLOT_NR,
  SLOT_P,
  SLOT_SNAPSHOT,
  shadowActual,
  shadowExternalRaise,
  shadowConsumeBypass,
  shadowEnter,
  shadowExpect,
  shadowLeave,
  shadowSeatClose,
  shadowSeatOpen,
  shadowThrown
} from "./seat.js";
import {
  notifyEpoch,
  bumpNotifyEpoch,
  clock,
  deferZombie,
  dirtyQueue,
  flushTransaction,
  adopted,
  globalQueue,
  GlobalQueue,
  heldTrim,
  holdNode,
  insertSubs,
  joinFuture,
  passLane,
  queuePendingNode,
  schedule,
  setPassLane,
  txOf,
  resolveTx,
  inEffectCallback,
  effectCallbackEvent,
  effectCallbackOwner,
  setEffectCallback,
  ANY_EVENT,
  passTx,
  joinPassTx,
  stagedReaders,
  staleReader,
  laneDirty,
  externalUntrackHook,
  freshHook,
  guessing,
  laneOutcomeHook,
  laneReadHook,
  laneStageHook,
  laneSeamsHook,
  laneServedHook,
  laneAdoptHook,
  holdStagingHook,
  holdWorkHook,
  keepReadersHook,
  laneWriteHook,
  observeFlightHook,
  wireExternalSourceHook,
  passHook,
  revertHook,
  heldRewrites
} from "./scheduler.js";
import type { Transaction } from "./scheduler.js";
import type {
  Computed,
  Link,
  NodeExtension,
  NodeOptions,
  Owner,
  RawSignal,
  Root,
  Signal
} from "./types.js";

// A tracked effect's heap visit is its empty compute phase, then the user
// queue: routing through the heap orders the run after the commit whatever
// phase the write came from (#3291).
GlobalQueue._update = el => {
  if ((el as any)._type === EFFECT_TRACKED) {
    deleteFromHeap(el, dirtyQueue);
    (el as any)._modified = true;
    globalQueue.enqueue(EFFECT_USER, (el as any)._run);
  }
  // A zombie's fate is the seam's; it runs now only for its lane's re-staging,
  // which shows ahead of any park (#3463).
  else if (el._flags & REACTIVE_ZOMBIE && !(el._flags & REACTIVE_LANE_DIRTY)) deferZombie(el);
  // A lane frame member follows mainline writes only: the lane's dirty is
  // cancelled (#3698, #4137). Folded away without the lane engine.
  else if (laneStageHook && el._flags & REACTIVE_ZOMBIE && laneFrameMember(el)) {
    deleteFromHeap(el, dirtyQueue);
    el._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_LANE_DIRTY);
  }
  // A reader the landing re-derives whose frame flight the seam parked
  // adopts it at its turn (verdict.ts `adoptParked`, D-25, F-9).
  else if (!(laneAdoptHook && el._x?._parked && laneAdoptHook(el, 1))) recompute(el);
};
/** The nearest non-zombie owner carries a lane's value or, an effect, is
 * listed in a lane. */
function laneFrameMember(el: Computed<any>): boolean {
  let o: any = el._parent;
  while (o._flags & REACTIVE_ZOMBIE) o = o._parent;
  return (
    (o._config & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE ||
    (o._type && o._x?._transaction?._lane)
  );
}
GlobalQueue._dispose = disposeChildren;

export const PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE =
  "[PRIMITIVE_IN_FORBIDDEN_SCOPE] Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled";
export const PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE =
  "[PRIMITIVE_IN_EFFECT_CALLBACK] Cannot create a memo, effect or root with no owner inside an effect callback. The effect " +
  "phase runs with no ambient owner, so a computation created here belongs to nobody: it is never disposed and never held. " +
  "Create it in the compute (a flow component owns its children), or parent it explicitly with runWithOwner.";
export const PRIMITIVE_IN_REF_CALLBACK_MESSAGE =
  "[PRIMITIVE_IN_EFFECT_CALLBACK] Cannot create a memo, effect or root inside a ref callback. A ref callback runs like " +
  "a render effect's callback; create it in the factory that returns the ref (the component body).";
/** Dev: a computed or root created ownerless in an effect callback is outside
 * every owner and hold. `runWithOwner` there is deliberate and allowed. */
export function assertNotInEffectCallback(): void {
  if (
    inEffectCallback &&
    context === effectCallbackOwner &&
    (effectCallbackEvent === ANY_EVENT || dispatchingEvent() === effectCallbackEvent)
  ) {
    const message = context
      ? PRIMITIVE_IN_REF_CALLBACK_MESSAGE
      : PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE;
    emitDiagnostic({
      code: "PRIMITIVE_IN_EFFECT_CALLBACK",
      kind: "lifecycle",
      severity: "error",
      message
    });
    throw new Error(message);
  }
}
export const REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope (component, computation) is not allowed. " +
  "Move the write outside or set the `ownedWrite` option if this is intentional.";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Calling refresh() inside an owned scope (component, computation) is not allowed. " +
  "Move the invalidation outside pure computation.";

export let tracking = false;
/** @internal verdict-module glue */
export function setContextInternal(v: Owner | null): void {
  context = v;
}
export let stale = false;
export let context: Owner | null = null;

export let snapshotCaptureActive = false;
/** The lane at the root of the running chain of first passes, inherited by
 * every first pass under it (#4166). */
let laneRoot: Transaction | null | false | undefined;
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
  if (active && !snapshotSources) snapshotSources = new NewSet();
}

/** Mark `owner` a snapshot scope: readers created under it serve each
 * source's value from when hydration began and replay at
 * `releaseSnapshotScope`. With `served`, `owner` is a hydrated computed and
 * `served` its server answer: it becomes the node's snapshot if it has none. */
export function markSnapshotScope(owner: Owner, served?: unknown): void {
  if (arguments.length < 2) owner._snapshotScope = true;
  else if (snapshotCaptureActive && (owner as Computed<any>)._x?._snapshotValue === undefined)
    takeSnapshot(owner as Computed<any>, served);
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
      // Assign, never `delete`: deleting pushes `_x` to dictionary mode.
      const x = source._x;
      if (x != null) x._snapshotValue = undefined;
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}

export function recompute(el: Computed<any>, create: boolean = false): void {
  // Any recompute can clean a marked subscriber: invalidate the skip (§12d).
  bumpNotifyEpoch();
  const isEffect = (el as any)._type;
  let released: Computed<any>[] | undefined;
  let superseded: unknown = NOT_PENDING;
  // Lanes: a pass is seated by its node. A node carrying a lane's value runs
  // as the lane's whoever dirtied it; a guess's own pass is its truth arriving,
  // the frame's (F-11). A first pass takes its creator's lane, except under a
  // verdict lane: a mount there is mainline (D-25, #3851). Restored at the end.
  // Folded away without the lane engine.
  const prevLane = passLane;
  // The mount a first pass belongs to, inherited from its creator (#4166).
  const prevMount = laneRoot;
  const mount = laneStageHook && (laneRoot = create && (prevLane || prevMount));
  // The seam's re-derive runs with its parked flight current; a later pass
  // asks its own question (D-25, verdict.ts `reask`).
  if (laneAdoptHook && !create && el._x) {
    const p = el._x._parked;
    if (
      p
        ? p !== el._x._inFlight && ((el._x._parked = undefined), 1)
        : el._config & CONFIG_OVERRIDE && !(el._flags & REACTIVE_LANE_DIRTY)
    )
      laneAdoptHook(el, 2);
  }
  // Shadow seat: the node's own lane.
  const shadowOwnLane = __TEST__
    ? (el._flags & REACTIVE_LANE_DIRTY ||
        (el._config & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE) &&
      el._x?._transaction?._lane
      ? el._x._transaction
      : null
    : null;
  if (laneStageHook) {
    const cp = create ? creatorPass(context) : null;
    const cf = (cp?._flags as number) | 0;
    // A first pass under a pass that probed is the mount the probe gates, and so
    // is what that pass creates (D-25, S-46, S-58, #4806).
    if (
      cf & REACTIVE_PROBED ||
      (cp &&
        ((cp._config & CONFIG_MOUNT_AHEAD && cp._statusFlags & STATUS_UNINITIALIZED) ||
          ((cp as any)._type === EFFECT_RENDER &&
            cp._depsTail &&
            hasDep(cp, d => d._config & CONFIG_VERDICT, cp._depsTail))))
    )
      el._config |= CONFIG_MOUNT_AHEAD;
    setPassLane(
      (el._flags & REACTIVE_LANE_DIRTY ||
        (el._config & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE) &&
        el._x?._transaction?._lane
        ? el._x._transaction
        : // Loose `!=`: false with no creator lane (undefined == null).
          prevLane?._parent!._verdict != prevLane && cf & REACTIVE_RECOMPUTING_DEPS
          ? prevLane
          : null
    );
  }
  // Observe: fired while `_deps` still holds the previous run's links.
  let devChanged = false;
  if (__OBSERVE__) {
    (el as any)._devWindows = 0;
    if (attrHooks !== null) attrHooks.recomputeStart(el, create);
  }
  // An error a pass staged, which this pass replaces.
  const replaced = el._config & CONFIG_STAGED_ERROR;
  let linked: unknown;
  if (!create) {
    deleteFromHeap(el, dirtyQueue);
    // A pending flight is the hold's own work (#3884), and so is a held async
    // memo's re-run with no window of its own (D-25, `holdWork`): clear the
    // verdict posture before the flight is superseded, or a frame read would
    // settle it and drop the hold. Not an effect. Folded away without the lane
    // engine.
    if (
      laneStageHook &&
      !isEffect &&
      (el._statusFlags & STATUS_PENDING ||
        (el._config & (CONFIG_ASYNC | CONFIG_OWN_PROBE | CONFIG_HELD)) ===
          (CONFIG_ASYNC | CONFIG_HELD))
    )
      el._config &= ~CONFIG_VERDICT;
    if (el._x !== null) {
      el._x._inFlight = null;
      // Supersede kills an iterator flight (#3122).
      releaseFlightTeardown(el);
    }
    // A pass over a held derivation joins its hold (D-1); a node held with nothing
    // staged joins too. Not a render effect or boundary structure: outside its
    // hold's flush the frame publishes mainline (#4283). A frame born into the
    // hold keeps staging (#4010).
    if (el._config & CONFIG_HELD) {
      const tx = txOf(el);
      // Under a blocked lane the frame joins nothing: a lane never holds a sync
      // write (#3460). An answered deferred node's re-pass lags and joins nothing
      // (D-40). A verdict reader born into the hold is its own work (D-25, D-12,
      // #4467). `EFFECT_RENDER << 23` is CONFIG_FRAME.
      if (tx._lane || el._config & CONFIG_LAGS) {
      } else if (
        !(el._config & (CONFIG_VERDICT | (EFFECT_RENDER << 23))) ||
        (observeFlightHook && !(el._config & (EFFECT_RENDER << 23)) && bornInto(el, tx))
      )
        joinPassTx(tx, freshHook?.(el, el._statusFlags & STATUS_UNINITIALIZED));
      else if (
        tx !== flushTransaction &&
        !(el._statusFlags & STATUS_UNINITIALIZED || el._config & CONFIG_HELD_FRAME)
      ) {
        // Published mainline, the frame is replaced on the spot and the landing
        // re-derives a held one (#3404). Readers of the superseded staging re-derive
        // even if the value is unchanged (#4378).
        if ((superseded = el._pendingValue) !== NOT_PENDING) insertSubs(el);
        el._pendingValue = NOT_PENDING;
        el._config &= ~CONFIG_HELD;
      }
    }
    // Children of a pass still awaiting its commit were never shown and die now;
    // otherwise they are the frame and park until this pass commits.
    if (isEffect === EFFECT_TRACKED || el._config & CONFIG_STAGED) {
      // Lazy nodes only those children read release at this pass's end unless
      // re-read (#4142). A throwing cleanup is rethrown when the flush ends.
      const prev = deferredReleases;
      deferReleases((released = []));
      disposeChildren(el);
      deferReleases(prev);
    } else if (el._firstChild !== null || el._disposal !== null) parkChildren(el);
    // This pass replaces a staged error (D-41, #4109, #4145); a held one stays
    // `latest`'s answer while this pass's flight is up (D-22). `linked`: the pass
    // had sources.
    if (passHook) {
      linked = el._deps !== null;
      // Only a node with an error to keep pays the call.
      if (el._x !== null && (el._config & CONFIG_STAGED_ERROR || el._x._aheadError !== undefined))
        passHook(el);
    }
    if (el._config & CONFIG_STAGED_ERROR) {
      el._pendingValue = NOT_PENDING;
      el._config ^= CONFIG_STAGED_ERROR;
    }
    if (__DEV__) clearSignals(el);
  }

  const wasUninitialized = el._statusFlags & STATUS_UNINITIALIZED;
  // Capture error and pending before the compute clears them: a dropped source
  // can leave blocked dependents outside its settle walk.
  const outgoingError = el._statusFlags & STATUS_ERROR && el._x?._error;
  const wasPending = (el._statusFlags & STATUS_PENDING) !== 0;
  const outgoingPendingSources = wasPending && el._x?._pendingSources;
  // A node whose own flight parked dependents, superseded and settled
  // synchronously here, settles them here: its landing never will (#3181).
  const wasPendingSource = el._x?._pendingSources?.has(el);
  // This pass's error is staged, not published (D-41).
  let stagedErr = false;
  // A `refresh()` is quiet unless the question in flight is new (F-9), or a
  // guess's new question is still held (#4336). A held user write is not an
  // answer, so a refresh over it is a re-ask (D-34, #4887, #4888).
  let reask =
    (el._flags & REACTIVE_REASK) !== 0 &&
    !(
      el._x !== null &&
      !el._x._reask &&
      (el._statusFlags & STATUS_PENDING ||
        (el._pendingValue !== NOT_PENDING &&
          !el._x._revert &&
          !(el._flags & REACTIVE_MANUAL_WRITE)))
    );

  // Shadow seat, compared with the seating above (reader-seat-rebuild.md §3.2).
  if (__TEST__)
    shadowSeatOpen(
      el,
      create,
      creatorPass(context),
      shadowOwnLane,
      mount,
      !!((creatorPass(context)?._flags as number) & REACTIVE_JOINED)
    );
  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._depGen++;
  // REACTIVE_ZOMBIE is position (on its owner's parked frame), so every per-pass
  // wipe keeps it (#3543). A release found while queued is this pass's tail's (#4474).
  const releaseAfter = el._flags & REACTIVE_RELEASE_AFTER;
  el._flags = REACTIVE_RECOMPUTING_DEPS | (el._flags & (REACTIVE_ZOMBIE | REACTIVE_REASK));
  el._time = clock;
  // The previous value: the staging, else the committed value.
  let value = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
  let oldHeight = el._height;
  let missedWake = false;
  // Whether this pass read the future, or for a lane's mount, this flush's staging (#3851, #4166).
  let joined = false;
  let prevTracking = tracking;
  let prevStrictRead: string | false = false;
  let prevStrictPending: string | false = false;
  if (__DEV__) {
    prevStrictRead = strictRead;
    prevStrictPending = strictPending;
    strictRead = strictPending = false;
  }
  const prevCopy = __DEV__ ? enterCopy() : undefined;
  tracking = true;
  const isStaleEffect = isEffect && isEffect !== EFFECT_USER;
  const prevStale = stale;
  if (isStaleEffect) stale = true;
  // Dev: only this pass's body is judged (D-42).
  if (__DEV__) clearThrownRead(el);
  try {
    // The sync fast arm is prod-only, so dev checks sync nodes too (D-42).
    if (!__DEV__ && el._config & CONFIG_SYNC) {
      value = el._fn(value);
      if (el._x !== null) el._x._inFlight = null;
      el._loading = false;
    } else {
      // A projection self-registers its flight; its undefined return is not an answer.
      const prevInFlight = el._x?._inFlight;
      const fnResult = el._fn(value);
      const isAsyncResult = typeof fnResult === "object" && fnResult !== null;
      const selfRegistered = el._x?._inFlight !== prevInFlight;
      // Dev: a body that returned after a read threw into it caught the throw,
      // unless it returned the flight the throw became (D-42).
      if (__DEV__) checkCaughtRead(el, selfRegistered ? el._x!._inFlight : fnResult);
      value = selfRegistered || !isAsyncResult ? fnResult : handleAsync(el, fnResult);
      if (!selfRegistered && !isAsyncResult) {
        if (el._x !== null) {
          el._x._inFlight = null;
          if (holdWorkHook) el._config &= ~CONFIG_ASYNC;
        }
        // A sync return is the first real answer.
        el._loading = false;
      }
    }
    // No `_x` means no status to clear. Lane work served the committed value of a
    // flight in the air keeps its pending, so a boundary keeps its fallback
    // (F-4, #4862).
    if (
      (el._statusFlags !== 0 || el._x !== null) &&
      !(laneServedHook && el._statusFlags & STATUS_PENDING && laneServedHook(el, null, true))
    )
      clearStatus(el, create);
  } catch (e) {
    const notReady = e instanceof NotReadyError;
    // An error or a loading window's unready read answers: no flight is its own
    // (D-25, `holdWork`). A pending pass keeps the last answer's.
    if (holdWorkHook && (!notReady || el._loading)) el._config &= ~CONFIG_ASYNC;
    if (notReady && el._loading) {
      // Loading window: register for the source's settle with no visible pending;
      // the loading value keeps serving and an error stays the answer.
      parkLoadingWindow(el, e as NotReadyError);
    } else {
      // A held pass, or one that read this flush's staging, stages its error (D-41).
      if (notReady || !(stagedErr = stageError(el, e, true))) {
        if (notReady) ext(el)._blocked = true;
        notifyStatus(el, notReady ? STATUS_PENDING : STATUS_ERROR, e);
        // If no new flight re-owned self, retire the superseded flight's copies.
        if (notReady && wasPendingSource && !el._x?._inFlight) settlePendingSource(el);
      }
      // A re-park drops sources this pass no longer reaches, from dependents that
      // reached them only through here; their landing walk stops at this node and
      // would never find them (#3456, #4541). Dependents with another path keep
      // the source. A still-pending source has its own walk to come.
      if ((notReady || stagedErr) && outgoingPendingSources)
        for (const source of outgoingPendingSources)
          if (
            source !== el &&
            !(
              el._x?._pendingSources?.has(source) &&
              (source._statusFlags & STATUS_PENDING || retryReaches(el, source))
            )
          )
            settlePendingSource(el, source);
    }
  } finally {
    tracking = prevTracking;
    if (laneStageHook) laneRoot = prevMount;
    if (__DEV__) {
      strictRead = prevStrictRead;
      strictPending = prevStrictPending;
      exitCopy(prevCopy);
    }
    if (isStaleEffect) stale = prevStale;
    // Consume the missed-wake latch (#3037). The wipe below must not key off
    // DIRTY/CHECK, which `read`'s pull sets as bookkeeping.
    missedWake = (el._flags & REACTIVE_MISSED_WAKE) !== 0;
    // A mount's staged read joins it, except a nested derivation left pending: no
    // render effect reaches it, so it holds nothing (F-3, #4203, #4340).
    joined = !!(
      el._flags &
      (mount
        ? prevLane || isEffect || !(el._statusFlags & STATUS_PENDING)
          ? REACTIVE_JOINED | REACTIVE_STAGED_READ
          : 0
        : REACTIVE_JOINED)
    );
    // Shadow seat: the born-held decision, then restore.
    if (__TEST__) shadowSeatClose(el, !!isEffect, joined, creatorPass(oldcontext), mount);
    // A verdict reader is one only while it probes or reads a memo that does
    // (D-25). Folded away without the verdict engine.
    if (observeFlightHook)
      el._config =
        (el._config & ~(CONFIG_VERDICT | CONFIG_OWN_PROBE | CONFIG_AHEAD)) |
        (el._flags & REACTIVE_PROBED) |
        ((el._flags & REACTIVE_WINDOW) << 9) |
        ((el._flags & REACTIVE_AHEAD) << 11);
    // REACTIVE_DISPOSED survives: the pass may have disposed its own owner (#3621).
    // REACTIVE_FRAME_READ is this pass's verdict for the landing.
    el._flags =
      (el._flags &
        (REACTIVE_ZOMBIE |
          REACTIVE_DISPOSED |
          REACTIVE_FRAME_READ |
          REACTIVE_STAGED_READ |
          REACTIVE_LANE_READ |
          REACTIVE_SCREEN_READ |
          REACTIVE_PROBE_UNANSWERED)) |
      (create ? el._flags & REACTIVE_SNAPSHOT_STALE : 0);
    context = oldcontext;
    if (released) for (const node of released) releaseIfSettledUnobserved(node);
    // A pending pass on a `refresh()`, or one that read only committed values,
    // is a quiet re-ask (F-9). Asked only of a pending pass: the dep walk is too dear.
    if (linked && !reask && el._statusFlags & STATUS_PENDING) reask = !!passHook!(el, 1);
    if (el._x !== null) el._x._reask = reask && (el._statusFlags & STATUS_PENDING) !== 0;
  }

  // A node that died during its own pass is void: unlink the reads made after
  // `dispose()`, retire its flight, and publish nothing (#3024, #3621).
  if (el._flags & REACTIVE_DISPOSED) {
    clearDeps(el);
    clearInFlight(el);
    if (__OBSERVE__ && attrHooks !== null)
      attrHooks.recomputeEnd(el, create, false, "plain", false);
    if (laneStageHook) setPassLane(prevLane);
    return;
  }
  // The lane this pass is work of. A pass that read none of the lane's world
  // has left it; a guess never leaves this way.
  let lane = !laneStageHook ? null : passLane;
  // False: the pass left the lane.
  const errored = !!el._x?._error || stagedErr;
  if (laneStageHook && lane !== null) {
    if (laneStageHook(el, lane, create, errored)) setPassLane(lane);
    else lane = null;
  }

  if (!errored) {
    // Observe (HUGE_FAN_IN): count the validated prefix here, not per link;
    // per-link counting cost ~6% on create benches.
    if (__OBSERVE__) {
      let fanIn = 0;
      for (let d = el._deps; d !== null; d = d._nextDep) {
        fanIn++;
        if (d === el._depsTail) break;
      }
      if (fanIn >= GRAPH_SIZE_WARN_AT) noteFanIn(el, fanIn);
    }
    // INV-11 (#3330): compare against the slot this run publishes to.
    const unstaged = el._pendingValue === NOT_PENDING;
    const compareValue = !unstaged ? el._pendingValue : el._value;
    // A throwing comparator is contained in `isSame` (#2837, #4111). Replacing a
    // staged error is a new answer even at the committed value (D-41, #4403); a
    // re-pass equal to a first value staged this frame changes nothing (#4540).
    const tx = flushTransaction ?? passTx;
    const valueChanged =
      (unstaged && wasUninitialized && !isEffect) ||
      !!el._x?._shownError ||
      // In a flush that joined a hold, a recovery to the last good value is a
      // change of answer (D-41, S-53).
      !!(outgoingError && tx) ||
      !!replaced ||
      // Lane work on a node a held pass created has no screen: its value is a
      // change (F-11, #3835).
      (lane !== null && (el._parent as Computed<any> | null)?._config! & CONFIG_HELD) ||
      !isSame(el, compareValue, value);

    // Observe: a committed derived change becomes a cause for this node's subscribers.
    if (__OBSERVE__ && attrHooks !== null) devChanged = !!valueChanged && !el._x?._error;

    // Effects use `_equals: false`; flag and enqueue here. `!create`: `effect()`
    // runs the first pass itself.
    if (
      isEffect &&
      valueChanged &&
      // A stale lane reader that computed what it last applied owes no run.
      !(
        el._flags & REACTIVE_SCREEN_READ &&
        !(el as any)._modified &&
        Object.is((el as any)._prevValue, value)
      ) &&
      // A re-staging pass owes no run: the commit replays the effect (#3802).
      unstaged
    ) {
      (el as any)._modified = !el._x?._error;
      // One bound runner per effect. Lane work's run is the lane's; a first pass's
      // run is `effect()`'s to queue (#4557).
      if (!create)
        globalQueue.enqueue(
          isEffect,
          ((el as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, el)),
          lane
        );
    }

    // A guess's own pass from the frame is its truth: staged under the lane's
    // parent, notifying only a correction (F-11, D-34). Hook first, so a build
    // without lanes folds it.
    if (
      laneOutcomeHook &&
      !create &&
      lane === null &&
      el._config & CONFIG_GUESS &&
      laneOutcomeHook(el, value, errored)
    ) {
    } else if (errored) {
      // Comparator threw: the error's propagation owns notification.
    } else if (valueChanged) {
      // A first pass is born held (staged, committed with the hold) when the flush
      // has joined a hold and the pass read a held node, or a verdict lane's mount
      // read this flush's staging (#3851), or a held pass created it (D-1). Any
      // other first pass publishes and re-derives if the flush parks. An effect
      // with an uncommitted staging re-stages.
      if (lane !== null) {
        // Lane work stages for the lane's next seam. An effect born held re-stages.
        if (isEffect && el._pendingValue === NOT_PENDING) el._value = value;
        else el._pendingValue = value;
        // A derivation born in the lane has no committed value until the lane lands.
        // Not an effect: marked uninitialized it re-ran without end (#4871).
        if (create && !isEffect) el._statusFlags |= STATUS_UNINITIALIZED;
      } else if (
        create
          ? !(
              tx !== null &&
              (joined || (creatorPass(oldcontext)?._flags as number) & REACTIVE_JOINED)
            )
          : isEffect && el._pendingValue === NOT_PENDING
      ) {
        // A first pass or an effect publishes directly. A memo stages even in a quiet
        // world: mid-batch pulls must see the fresh value while plain reads stay
        // committed until flush (#3009).
        el._value = value;
      } else {
        el._pendingValue = value;
        // A staged recovery keeps the error on display until it commits (D-41).
        if (outgoingError) el._x!._shownError = outgoingError;
        // Born held: a read of it this tick is a read of the hold's world.
        if (create) {
          holdNode(el, tx!);
          // No committed value until the landing (F-9).
          el._statusFlags |= STATUS_UNINITIALIZED;
          // A boundary that has not shown content catches it (#3540), unless the mount
          // is part of the hold itself: then it appears at the commit (D-12).
          freshHook?.(el, !mount && flushTransaction);
        }
        if (__DEV__) devTrackHeldPending(el);
      }

      // Lane work notifies its members as lane work (`laneDirty`).
      if (el._subs !== null) lane !== null ? laneDirty(el, lane) : insertSubs(el);
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) insertIntoHeapHeight(s._sub, dirtyQueue);
    }

    // Silent recovery to an unchanged value: re-run dependents still holding the
    // propagated error (#2949).
    if (!valueChanged && !el._x?._error) {
      if (outgoingError) settleErroredDependents(el, outgoingError);
      // Self-registration is the #3181 sweep's below.
      if (outgoingPendingSources)
        for (const source of outgoingPendingSources)
          if (source !== el) settlePendingSource(el, source);
    }

    // A synchronous settle supersedes the old landing callback, so this pass
    // sweeps (#3181). An uninitialized node with no replacement stays parked.
    if (wasPendingSource && !(el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)))
      settlePendingSource(el);
  }
  // A first pass gone pending where it would have been born held is held: its
  // answer is the hold's (D-1). Under a boundary that has not shown content it
  // is held but the hold does not wait for it (F-4, #3540); an `on` re-arm owns
  // it (D-12). A derivation left pending reaches no boundary (#4542).
  if (create && lane === null && joined && el._statusFlags & STATUS_PENDING) {
    const t = flushTransaction ?? passTx;
    t && !t._lane && ((isEffect && freshHook?.(el) === CAUGHT_REARMED) || holdNode(el, t));
  }
  // Dependencies are the committed frame's until it is replaced (D-10, #3410):
  // a staging leaves the old tail for `commitPendingNode` to trim. An errored
  // pass keeps its list. An effect trims when its run applies (#3438). An
  // unchanged pass waits on the flush's verdict (#3469). Creation passes and
  // tracked effects trim now; lane work counts as unchanged.
  if (
    !el._x?._error &&
    (lane !== null || el._pendingValue === NOT_PENDING) &&
    !(isEffect && (el as any)._modified)
  ) {
    if (create || isEffect === EFFECT_TRACKED) trimStaleDeps(el);
    else heldTrim(el);
  }
  // Observe: the posture the run executed under.
  if (__OBSERVE__ && attrHooks !== null)
    attrHooks.recomputeEnd(
      el,
      create,
      devChanged,
      lane !== null
        ? "optimistic"
        : flushTransaction !== null || passTx !== null || (el._config & CONFIG_HELD) !== 0
          ? "held"
          : "plain",
      el._pendingValue !== NOT_PENDING
    );
  // Queue for this flush's commit: a staged value, a parked frame, or status
  // to settle. A first pass only when pending or born held. Its children stay
  // CONFIG_STAGED until then.
  if (
    el._pendingValue !== NOT_PENDING ||
    (el._x !== null && (el._x._pendingFirstChild !== null || el._x._pendingDisposal !== null)) ||
    ((el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)) !== 0 &&
      (!create || (el._statusFlags & STATUS_PENDING) !== 0))
  ) {
    el._config |= CONFIG_STAGED;
    // Lane work is the lane's to reveal.
    if (lane === null) queuePendingNode(el);
  }
  if (laneStageHook) setPassLane(prevLane);
  // Missed wake: values read before the nested commit are stale, so run again.
  // Equality gates keep it convergent.
  if (missedWake) {
    enqueueSub(el);
    schedule();
  }
  // Re-derived to the staging it superseded: held readers keep their pass (#4417).
  if (keepReadersHook && superseded !== NOT_PENDING && Object.is(value, superseded))
    keepReadersHook(el);
  // A release a settle deferred past this pass (#2934, #4474).
  if (releaseAfter) releaseIfSettledUnobserved(el);
}

function updateIfNecessary(el: Computed<unknown>): void {
  // Never re-enter a computing node: its dep bookkeeping is live (#3037).
  // Never recompute a disposed node: it would come back alive (#2983).
  if (el._flags & (REACTIVE_RECOMPUTING_DEPS | REACTIVE_DISPOSED)) return;
  if (el._flags & REACTIVE_CHECK) {
    for (let d = el._deps; d; d = d._nextDep) {
      const dep = d._dep;
      if ((dep as Computed<unknown>)._fn) {
        updateIfNecessary(dep as Computed<unknown>);
      }
      if (el._flags & REACTIVE_DIRTY) {
        break;
      }
    }
  }

  if (el._flags & REACTIVE_DIRTY || (el._x?._error && el._time < clock && !el._x?._inFlight)) {
    recompute(el);
  }

  // The pass may have disposed the node (#3621): carry the flag. The manual
  // write mark is state, lifted only by a re-deriving pass or the commit
  // (D-8, #3612); keep the last pass's landing verdicts too.
  el._flags =
    el._flags &
    (REACTIVE_SNAPSHOT_STALE |
      REACTIVE_IN_HEAP |
      REACTIVE_IN_HEAP_HEIGHT |
      REACTIVE_ZOMBIE |
      REACTIVE_DISPOSED |
      REACTIVE_MANUAL_WRITE |
      REACTIVE_FRAME_READ |
      REACTIVE_STAGED_READ |
      REACTIVE_LANE_READ |
      REACTIVE_SCREEN_READ |
      REACTIVE_PROBE_UNANSWERED);
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
  // `in`: an explicit `loadingValue: undefined` is a real commit #0.
  const loading = options !== null && typeof options === "object" && "loadingValue" in options;
  // One literal per tier, chosen at build time. Observe adds `_name`/`_loc` as
  // literal slots: a later write forces a hidden-class transition on every
  // node. Keep the two in sync; the dist artifact test pins the key sets.
  const self: Computed<T> = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
          // Plumbing is observe-only; prod never carries the bit.
          (options?._plumbing ? CONFIG_PLUMBING : 0) |
          (options?._extraConfig ?? 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: options?.equals ?? isEqual,
        _disposal: null,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: (loading ? options!.loadingValue : undefined) as T,
        _height: 0,
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
        _statusFlags: loading ? 0 : STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _notifiedAt: -1,
        _loading: loading,
        _x: null,
        // Always present for the hidden class; plumbing leaves it unset.
        _name: options?._plumbing ? undefined : (options?.name ?? "computed"),
        _loc: options?.loc,
        // Observe: windows this pass entered; a slot, never a later write.
        _devWindows: 0
      } as Computed<T>)
    : ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
          (options?._extraConfig ?? 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: options?.equals ?? isEqual,
        _disposal: null,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: (loading ? options!.loadingValue : undefined) as T,
        _height: 0,
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
        _statusFlags: loading ? 0 : STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _notifiedAt: -1,
        _loading: loading,
        // Cold fields live in `_x`: past ~39 in-object fields creation cost ~4x (§12).
        _x: null
      } as Computed<T>);
  if (options?.unobserved) (ext(self) as NodeExtension)._unobserved = options.unobserved;
  if (__DEV__ && options?._supersedes) self._config |= CONFIG_SUPERSEDES;
  setupComputedNode(self, options);
  return self;
}

/** Lazily allocate the cold extension. Hot paths read `el._x?._field` behind
 * `_config` bits; never call `ext()` just to store a default. */
export function ext(el: { _x: NodeExtension | null }): NodeExtension {
  return (el._x ??= {
    _inFlight: null,
    _flightTeardown: null,
    _error: undefined,
    _blocked: undefined,
    _pendingSources: undefined,
    _unobserved: undefined,
    _snapshotValue: undefined,
    _pendingFirstChild: null,
    _pendingDisposal: null,
    _transaction: null,
    _reask: false,
    _flushed: NOT_PENDING,
    _flushedAt: -1,
    _q: 0,
    _shown: false,
    _marks: 0,
    _shownError: null
  });
}

/** A tracked read of a held node joins the flush to its hold (D-1), unless the
 * reader is a render effect: the frame reads the committed value outside its
 * hold's flush (D-25, `frameRead`). A node born held has no committed value,
 * so every reader joins. Under a boundary that has not shown content, a first
 * pass is the boundary's (F-4, #3540). */
/** The pass whose plain read made this flush adopt a hold: a window it then
 * opens can give the hold back (#4777). */
export let adopter: Computed<any> | null = null;
export function setAdopter(c: Computed<any> | null): void {
  adopter = c;
}
export function joinPass(c: Computed<any>, el: Signal<any> | Computed<any>): void {
  if (observeFlightHook && !flushTransaction) ((adopter = c), (adopted.length = 0));
  c._flags |= REACTIVE_JOINED;
  if (__TEST__) shadowExternalRaise(c, RAISE_H);
  // A new memo's first pass is the hold's work but not the tick's: the render
  // effect reading it decides (F-3, #3540).
  if (
    (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED ||
    (c as any)._type !== EFFECT_RENDER
  )
    joinPassTx(
      txOf(el),
      (!(c as any)._type && c._statusFlags & STATUS_UNINITIALIZED) || freshHook?.(c)
    );
}

/** `joinPass` into hold `t` (a folded guess, D-34); never a render effect. */
export function joinPassAt(c: Computed<any>, t: Transaction): void {
  c._flags |= REACTIVE_JOINED;
  if (__TEST__) shadowExternalRaise(c, RAISE_H);
  joinPassTx(t, (!(c as any)._type && c._statusFlags & STATUS_UNINITIALIZED) || freshHook?.(c));
}

/** A frame reader of a node another hold holds is served the committed value,
 * publishes mainline and re-derives at that landing (D-25). Not one born
 * into that hold (#4010), nor a flight whose inputs already show: that would
 * tear (F-1, #3305). Lane work is a frame reader too: a lane sees the screen
 * plus its own guesses (F-6). */
function frameRead(c: Computed<any>, el: Signal<any> | Computed<any>): boolean {
  // Frame readers: render effects, verdict readers and lane work (D-25); a
  // boundary's tree and output too (#4283). Not a mount's memo: the hold's own
  // later passes read it (D-1). Not a pass with only an inherited posture
  // reading the hold's own write (D-25, #4544).
  const verdict = observeFlightHook && c._config & CONFIG_VERDICT;
  const lane = laneStageHook && passLane !== null;
  // A render effect a probing pass is mounting is born held on the hold's
  // staging or flight, whatever else it read (D-25, S-46, S-58). Not lane work
  // reading a held node that is not pending. Folded away without lanes.
  if (
    laneStageHook &&
    c._config & CONFIG_MOUNT_AHEAD &&
    c._statusFlags & STATUS_UNINITIALIZED &&
    (!lane || (el as Computed<any>)._statusFlags & STATUS_PENDING)
  ) {
    joinPass(c, el);
    return false;
  }
  if (
    !(verdict && holdStagingHook!(c, el)) &&
    !(
      (!lane ||
        (c._statusFlags & STATUS_UNINITIALIZED &&
          (el as Computed<any>)._statusFlags & STATUS_PENDING)) &&
      !verdict &&
      (!(c._config & (EFFECT_RENDER << 23)) || el._config & CONFIG_INPUTS_PUBLISHED)
    )
  ) {
    const t = txOf(el);
    // Lane work and verdict readers are never the hold's pass, except a lane
    // re-based over this hold's answer: it reads that staging without joining
    // (F-1, F-7, D-34; #4536, #4576, #4643).
    if (lane && passLane!.over && resolveTx(passLane!.over) === t && !verdict) return false;
    if (!((!lane && t === flushTransaction && !verdict) || bornInto(c, t))) {
      staleReader(c, t);
      // They no longer wait on `el`'s flight.
      if (lane || verdict) laneServedHook!(c, el);
      return true;
    }
  }
  joinPass(c, el);
  return false;
}

/** Born into `t`: held and never committed, or a member of a frame its held
 * pass built. It reads `t`'s values in any flush and keeps staging (#4010). */
export function bornInto(c: Computed<any>, t: Transaction): unknown {
  return (
    (c._statusFlags & STATUS_UNINITIALIZED || c._config & CONFIG_HELD_FRAME) &&
    c._config & CONFIG_HELD &&
    txOf(c) === t
  );
}

/** With `tail`, this pass's reads only. */
function hasDep(
  c: Computed<any>,
  f: (d: Signal<any> | Computed<any>) => unknown,
  tail?: Link | null
): unknown {
  for (let d = c._deps; d !== null; d = d === tail ? null : d._nextDep) if (f(d._dep)) return 1;
}
/** A staging a verdict pass reads for the first time is content it opens,
 * not a value it keeps (D-25, S-46, #4806). */
let fresh: unknown;
function readsFresh(c: Computed<any>, el: Signal<any> | Computed<any>): unknown {
  return (
    el._pendingValue !== NOT_PENDING && c._config & CONFIG_VERDICT && !hasDep(c, d => d === el)
  );
}

/** The computed a creation under `owner` belongs to, or null. */
export function creatorPass(owner: Owner | null): Computed<any> | null {
  return owner !== null && (owner as Root)._root
    ? (owner as Root)._parentComputed
    : (owner as Computed<any> | null);
}

/** Whether the passes running around `p` read the future or a staging: a pass
 * they created has no screen (#4341). */
export function creatorReads(p: Computed<any> | null, born: number): number {
  return (p = creatorPass(p!._parent))?._flags! & REACTIVE_RECOMPUTING_DEPS
    ? creatorReads(p, born | p!._flags)
    : born & (REACTIVE_JOINED | REACTIVE_STAGED_READ);
}

/** Park the previous pass's children and disposal list until this node's
 * commit replaces them. */
function parkChildren(el: Computed<unknown>): void {
  markDisposal(el);
  const x = ext(el);
  x._pendingDisposal = el._disposal;
  x._pendingFirstChild = el._firstChild;
  el._disposal = null;
  el._firstChild = null;
  el._childCount = 0;
}

/** One literal with every effect field, so V8 sees the full shape at construction. */
export function createEffectNode<T>(
  fn: (prev?: T) => T,
  effectFn: (val: T, prev: T | undefined) => void | (() => void),
  errorFn: ((err: unknown, cleanup: () => void) => void | (() => void)) | undefined,
  type: number,
  options: NodeOptions<T> | undefined
): any {
  const transparent = options?.transparent ?? false;
  // See `computed()` for the observe slots.
  const self = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, context),
        _config:
          // CONFIG_FRAME for a render effect.
          (type << 23) |
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._extraConfig ?? 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: false as unknown as Computed<T>["_equals"],
        _disposal: null,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: undefined as T,
        _height: 0,
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
        _notifiedAt: -1,
        _loading: false,
        _modified: false,
        _prevValue: undefined as T | undefined,
        _effectFn: effectFn,
        _errorFn: errorFn,
        _cleanup: undefined as (() => void) | undefined,
        _type: type,
        _x: null,
        _name: options?.name ?? "effect",
        _loc: options?.loc,
        _devWindows: 0
      } as any)
    : ({
        id: inheritId(options, transparent, context),
        _config:
          // CONFIG_FRAME for a render effect.
          (type << 23) |
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._extraConfig ?? 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: false as unknown as Computed<T>["_equals"],
        _disposal: null,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: undefined as T,
        _height: 0,
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
        _notifiedAt: -1,
        _loading: false,
        _modified: false,
        _prevValue: undefined as T | undefined,
        _effectFn: effectFn,
        _errorFn: errorFn,
        _cleanup: undefined as (() => void) | undefined,
        _type: type,
        _x: null
      } as any);
  // Effects share one status notifier (`statusNotifierOf`): a per-node one
  // forced an `_x` on every effect (+23% creation).
  if (options?.unobserved) ext(self)._unobserved = options.unobserved;
  // Dev only: observe mangles `_` option names (CONFIG_WIDE).
  if (__DEV__ && options?._wide) self._config |= CONFIG_WIDE;
  setupComputedNode(self, lazyOptions);
  return self;
}

/** The shared effect status notifier, installed by effect.ts. */
export let effectStatusNotify: ((this: any) => void) | null = null;
export function setEffectStatusNotify(fn: NonNullable<typeof effectStatusNotify>): void {
  effectStatusNotify = fn;
}

/** Effect nodes get the shared notifier; presence also marks a display consumer. */
export function statusNotifierOf(el: any): ((this: any) => void) | null {
  return el._type ? effectStatusNotify : null;
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
  if (__DEV__) assertNotInEffectCallback();
  if (context) linkChild(context, self);
  if (__DEV__) DEV.hooks.onOwner?.(self);
  if (parent) self._height = parent._height + 1;
  wireExternalSourceHook?.(self);
  !options?.lazy && recompute(self, true);
  if (snapshotCaptureActive && !options?.lazy) {
    if (!(self._statusFlags & STATUS_PENDING) && !(self._config & CONFIG_NO_SNAPSHOT))
      takeSnapshot(self, self._value);
  }
}

export function signal<T>(v: T, options?: NodeOptions<T>): Signal<T> {
  // See `computed()`. Observe adds `_name`, `_loc` and `_owner` (for owner paths).
  const s = __OBSERVE__
    ? {
        _equals: options?.equals ?? isEqual,
        _config:
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0),
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _notifiedAt: -1,
        _x: null,
        _name: options?.name ?? "signal",
        _loc: options?.loc,
        _owner: null as Owner | null
      }
    : {
        _equals: options?.equals ?? isEqual,
        _config:
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0),
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _pendingValue: NOT_PENDING,
        // No `_time`/`_fn`/`_statusFlags`: stores make one signal per touched leaf,
        // so signal bytes are store bytes. Missing reads falsy on shared paths (§12e).
        _notifiedAt: -1,
        _x: null
      };
  if (__DEV__) (s as any)._internal = false;
  if (options?.unobserved) ext(s as any)._unobserved = options.unobserved;
  if (snapshotCaptureActive && !(s._config & CONFIG_NO_SNAPSHOT)) takeSnapshot(s as Signal<T>, v);
  return s as Signal<T>;
}

export function isEqual<T>(a: T, b: T): boolean {
  return a === b;
}

/** A store slot node in one literal: target and key as back-refs, the wrap
 * cache (`px`/`pxv`) and accessor verdict pre-shaped. No options, no `_x`,
 * no expandos. Observe adds label and location slots. */
export function slotSignal<T>(
  v: T,
  equals: (a: T, b: T) => boolean,
  host: object,
  key: PropertyKey,
  acc: boolean
): Signal<T> {
  const s = __OBSERVE__
    ? {
        _equals: equals,
        _config: CONFIG_OWNED_WRITE | CONFIG_SLOT_NODE,
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _notifiedAt: -1,
        _x: null,
        _host: host,
        _key: key,
        acc,
        px: undefined,
        pxv: undefined,
        _name: "signal",
        _loc: undefined as string | undefined,
        _owner: null as Owner | null
      }
    : {
        _equals: equals,
        _config: CONFIG_OWNED_WRITE | CONFIG_SLOT_NODE,
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _notifiedAt: -1,
        _x: null,
        _host: host,
        _key: key,
        acc,
        px: undefined,
        pxv: undefined
      };
  if (__DEV__) (s as any)._internal = false;
  return s as unknown as Signal<T>;
}

/** Dev: when set to a component name, a reactive read outside a nested
 * tracking scope warns. Managed by `untrack(fn, strictReadLabel)`. */
/** The verdict windows' read, set while a window is open. */
export let verdict: ((el: Signal<any> | Computed<any>, c: Computed<any> | null) => unknown) | null =
  null;
export function setVerdict(fn: typeof verdict): void {
  verdict = fn;
}
export let strictRead: string | false = false;
/** Dev: the label a plain `untrack` keeps from its strict scope, so a pending
 * read of a memo the same body created throws `PENDING_ASYNC_UNTRACKED_READ`
 * (it would loop). A memo created outside is a sanctioned read (D-23). */
let strictPending: string | false = false;
export let untrackDepth = 0;
/** Dev: > 0 while user code that is imperative by construction runs (effect
 * callback, action slice), so the post-await check does not blame the caller. */
export let callbackDepth = 0;
export function enterCallback(): void {
  callbackDepth++;
}
export function exitCallback(): void {
  callbackDepth--;
}
/** Dev: > 0 while teardown runs cleanups: their writes are imperative too, so
 * the owned-scope guard stands down (#4165). No try/finally here (prod), so
 * dev.ts resets it on the next microtask. */
export let disposalDepth = 0;
export function enterDisposal(): void {
  disposalDepth++;
}
export function exitDisposal(): void {
  disposalDepth--;
}
export function resetDisposalDepth(): void {
  disposalDepth = 0;
}
/** Dev: the event current when the strict-read window opened, or `ANY_EVENT`.
 * A handler dispatched synchronously from an effect callback is a snapshot,
 * so a read under a different event is outside the window (#4235). Read
 * once per queue: the getter is costly under jsdom. */
export let strictReadEvent: unknown;
// `?? null`: no current event must not read as a missing argument.
export const dispatchingEvent = (): unknown => (globalThis as any).event ?? null;
export function setStrictRead(v: string | false, event: unknown = ANY_EVENT): string | false {
  const prev = strictRead;
  strictRead = v;
  strictReadEvent = event;
  return prev;
}
/** Dev-only: runs `fn` inside the strict-read window labelled `label`, tracking
 * unchanged. Compiled dev DOM output wraps event handler expressions in it
 * (#1742). Production builds just call `fn`. */
export function strictReadTracked<T>(fn: () => T, label: string = EVENT_HANDLER_READ): T {
  if (!__DEV__) return fn();
  const prevStrictRead = strictRead;
  const prevStrictReadEvent = strictReadEvent;
  strictRead = label;
  strictReadEvent = ANY_EVENT;
  try {
    return fn();
  } finally {
    strictRead = prevStrictRead;
    strictReadEvent = prevStrictReadEvent;
  }
}
export function strictReadActive(): boolean {
  return !!strictRead && (strictReadEvent === ANY_EVENT || dispatchingEvent() === strictReadEvent);
}

/**
 * Runs `fn` outside of any reactive tracking — reads inside `fn` will not
 * subscribe the current scope. Returns whatever `fn` returns.
 *
 * Use `untrack` inside a memo or effect when you need to read a signal once
 * without making the surrounding computation depend on its future changes.
 *
 * In a component body, `untrack` marks a read as a deliberate one-time
 * snapshot and silences `STRICT_READ_UNTRACKED`. Use it only when the value
 * must never update and is never downstream of async: an async-derived value
 * can still be pending (the read throws) or mid-transition (the snapshot is
 * the old committed value). When it should follow its source, move the read
 * to where the value is used (JSX, a memo, an effect's compute, the event
 * handler, or an accessor passed to the hook that needs it) instead.
 *
 * `untrack` stops dependency tracking, not async settlement. Reading an
 * uninitialized async source still suspends the owning computation; it runs
 * again when that source first resolves. Afterward, the untracked read is a
 * snapshot and does not subscribe the computation to later changes.
 *
 * If the first read must return immediately, give the async source a
 * `loadingValue` before reading it with `untrack`. `isPending` and `latest`
 * inspect updates to an existing value; neither supplies a missing initial
 * value.
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
 *
 * const color = createMemo<string>(() => fetchColor(), { loadingValue: "gray" });
 * const initialColor = untrack(color); // "gray" while the fetch is unresolved
 * ```
 */
export function untrack<T>(fn: () => T, strictReadLabel?: string | false): T {
  const prevTracking = tracking;
  const prevStrictRead = strictRead;
  const prevStrictReadEvent = strictReadEvent;
  const prevStrictPending = strictPending;
  tracking = false;
  if (__DEV__) {
    if (strictReadLabel === undefined) {
      if (strictReadActive()) strictPending = strictRead;
    } else strictPending = false;
    strictRead = strictReadLabel || false;
    strictReadEvent = ANY_EVENT;
    untrackDepth++;
  }
  try {
    if (externalUntrackHook) return externalUntrackHook(fn);
    return fn();
  } finally {
    tracking = prevTracking;
    if (__DEV__) {
      strictRead = prevStrictRead;
      strictReadEvent = prevStrictReadEvent;
      strictPending = prevStrictPending;
      untrackDepth--;
    }
  }
}

/** > 0 while `runRefCallback` runs: a ref born into a held node's hold may
 * read its staging (#4767, F-7). */
let refCallbackDepth = 0;

/** A write, refresh, action call or `onFlush` here is an effect callback's
 * imperative work, not a computation's. */
export function inRefCallback(): boolean {
  return (
    refCallbackDepth > 0 ||
    (inEffectCallback && context !== null && context === effectCallbackOwner)
  );
}

/** Runs a compiled `ref()` callback untracked in the creating pass's context
 * (#4761); in dev, creating a primitive there is PRIMITIVE_IN_EFFECT_CALLBACK.
 *
 * @internal */
export function runRefCallback(fn: () => void): void {
  refCallbackDepth++;
  try {
    if (__DEV__) {
      const prev = inEffectCallback,
        prevEvent = effectCallbackEvent,
        prevOwner = effectCallbackOwner;
      setEffectCallback(true, ANY_EVENT, context);
      try {
        // No strict-read window: a ref's reads are imperative, as in an
        // event handler or an effect callback (#5098).
        untrack(fn, false);
      } finally {
        setEffectCallback(prev, prevEvent, prevOwner);
      }
    } else untrack(fn);
  } finally {
    refCallbackDepth--;
  }
}

/** A bookkeeping read on behalf of no node: it records no re-run link (#3528)
 * and no transaction entry (#3540) on `context`. */
export let spectating = false;

/** Evaluates `fn` untracked as a bookkeeping read (`spectating`). */
export function spectate<T>(fn: () => T): T {
  const prev = spectating;
  spectating = true;
  try {
    return untrack(fn);
  } finally {
    spectating = prev;
  }
}

export function prepareComputed(comp: Computed<unknown>, refresh: boolean): void {
  if (comp._flags & REACTIVE_LAZY) {
    comp._flags &= ~REACTIVE_LAZY;
    recompute(comp as Computed<any>, true);
  } else if (comp._flags & REACTIVE_DISPOSED) {
    // Two disposal lifecycles share the flag (#3024): a dormant auto-dispose node
    // wakes on read (pay-for-use); an owner-disposed one is dead and serves its
    // last committed value, since recomputing runs user code in a torn-down tree.
    if (comp._config & CONFIG_AUTO_DISPOSE) {
      const parent = comp._parent as Computed<unknown> | null;
      if (parent !== null) {
        // A dormant node was off the chain when its owner died (#3024).
        if (parent._flags & REACTIVE_DISPOSED) {
          comp._config &= ~CONFIG_AUTO_DISPOSE;
          return;
        }
        // A zombie never left its chain: relinking would put it on the live one too.
        if (!(comp._flags & REACTIVE_ZOMBIE)) linkChild(parent, comp);
      }
      recompute(comp as Computed<any>, true);
    }
  } else if (refresh) {
    updateIfNecessary(comp);
  }
}

/** Does reader `c` see a staged node's committed value? Read's fast block
 * carries the same test inline. An untracked read and a frame-only reader
 * (createTrackedEffect / onSettled, D-29) see the committed frame. */
export function readerSeesCommitted(
  el: Signal<any> | Computed<any>,
  c: Computed<any> | null
): boolean {
  return (!c ||
    el._pendingValue === NOT_PENDING ||
    c._config & CONFIG_CHILDREN_FORBIDDEN) as boolean;
}

/** Set when a node is staged outside a flush, cleared when a flush begins:
 * one module boolean keeps the F-10 arm free inside a flush. */
export let unflushedStaged = false;
export function markUnflushedStaged(): void {
  unflushedStaged = true;
}

/** A write is visible from the flush that carries it (F-10): outside a flush
 * a staged node serves its committed value. Promoted writes are exempt. */
export function unflushedValue(el: Signal<any> | Computed<any>): unknown {
  if (globalQueue._running || el._pendingValue === NOT_PENDING || el._config & CONFIG_PROMOTED)
    return NOT_PENDING;
  // A held node was flushed and parked: not unflushed unless rewritten since,
  // then the flushed staging is what the world sees until the next flush.
  if (el._config & CONFIG_HELD) return el._x!._flushedAt === clock ? el._x!._flushed : NOT_PENDING;
  return el._value;
}
/** The value a signal had when this tick began writing it (F-10). */
export function tickBase(el: Signal<any>): unknown {
  return el._config & CONFIG_HELD && el._x?._flushedAt === clock ? el._x._flushed : el._value;
}
/** A held node rewritten outside a flush keeps the last flushed staging until
 * the flush that carries the rewrite (F-10); the clock stamps the stash. */
export function stashFlushed(el: Signal<any> | Computed<any>): void {
  const x = el._x!;
  if (x._flushedAt !== clock) {
    // D-8: the flush checks whether the rewrite nets (verdict.ts `revert`).
    // Once per node per flush: the stamp below dedupes it.
    if (revertHook) heldRewrites.push(el);
    x._flushed = el._pendingValue;
    x._flushedAt = clock;
    unflushedStaged = true;
  }
}
const promotedWrites: Array<Signal<any> | Computed<any>> = [];
/** A derivation served the committed value because of an unflushed write runs
 * again in the flush that carries it: it linked after the write walked (F-10, #3337). */
export function markLateLinker(c: Computed<any>): true {
  // A direct enqueue here would be wiped by the pass's flag reset.
  c._flags |= REACTIVE_MISSED_WAKE;
  return true;
}

export function resyncUnflushedCompanions(): void {
  unflushedStaged = false;
  // Length-guarded so the common flush allocates nothing.
  if (promotedWrites.length !== 0) {
    for (const el of promotedWrites) el._config &= ~CONFIG_PROMOTED;
    promotedWrites.length = 0;
  }
}

export function pullComputed(owner: Computed<any>, c: Computed<any>): void {
  if (owner._height >= dirtyQueue._min || owner._flags & REACTIVE_CHECK) {
    markNode(c);
    markHeap(dirtyQueue);
    updateIfNecessary(owner);
  }
  // A fresh-pull waiter (awaitable refresh) recomputes a dirty source inline:
  // it must park on the re-ask, never read the pre-re-ask value as settled.
  else if (c._config & CONFIG_FRESH_READ) updateIfNecessary(owner);
  const height = owner._height;
  // parent check is shallow, might need to be recursive
  if (owner._parent === c) owner._flags |= REACTIVE_OWNER_READS;
  else if (height >= c._height) liftOwned(c, (c._height = height + 1));
}

/** Dev: every read's diagnostics. `nodeValue`'s first landing serves a store
 * leaf without `read`, so it calls this too. */
export function devRead(el: Signal<any> | Computed<any>): void {
  DEV.hooks.onRead?.(el);
  if (!tracking) checkForeignRead();
  if (asyncTailFlights !== 0 && !tracking && untrackDepth === 0)
    checkPostAwaitRead(
      el,
      el,
      undefined,
      (el as any)._name,
      ((el as any)._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)) ===
        (STATUS_PENDING | STATUS_UNINITIALIZED)
    );
}

/** A first answer staged this flush and re-asked in it (D-22, F-9): a memo
 * with no value derives from that answer once, as a flush of the answer
 * alone would have let it, then waits on the re-ask. One served pass a
 * flush (`_served`), or a pass that throws anyway re-runs without end. Not a
 * render effect, lane work, a verdict lane's pass (D-25) or a held node. */
function servesStaged(c: Computed<any>, el: Signal<any> | Computed<any>, owner: Computed<any>) {
  return (
    passLane === null &&
    c._statusFlags & owner._statusFlags & STATUS_UNINITIALIZED &&
    el._pendingValue !== NOT_PENDING &&
    !(el._config & (CONFIG_HELD | CONFIG_STAGED_ERROR)) &&
    !(c as any)._type &&
    (c._flags & REACTIVE_MISSED_WAKE ||
      (c._pendingValue === NOT_PENDING &&
        c._x?._served !== clock &&
        (!(c._statusFlags & STATUS_PENDING) ||
          c._x?._pendingSources?.delete((owner._x!._error as NotReadyError).source)) &&
        ((ext(c)._served = clock), (c._flags |= REACTIVE_MISSED_WAKE))))
  );
}

/** @internal Compiler output (`@solidjs/web`): truthy while the running pass is
 * a stale reader of an open hold (D-9). A grouped stateful prop binding then
 * skips an unchanged write, so a sibling's re-run does not put the committed
 * value back over the field (#4872). */
export function heldRead(): number {
  return (context as Computed<any>)._flags & REACTIVE_FRAME_READ;
}

export function read<T>(el: Signal<T> | Computed<T>): T;
// Typed `any` so `el` needs no cast alias: an alias the minifier keeps.
export function read<T>(el: any): T {
  // Shadow (seat.ts): compare the slot the table predicts with the one served.
  if (__TEST__ && !shadowConsumeBypass()) return shadowRead(el);
  if (__DEV__) devRead(el);

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;

  // The verdict windows' read (verdict.ts), off this path. It wakes a lazy or
  // dormant memo outside the window (#4366).
  if (verdict !== null) {
    // Dev: the window's throws are this read's throws (D-42).
    if (__DEV__) {
      try {
        return verdict(el, c as Computed<any> | null) as T;
      } catch (e) {
        noteThrownRead(el, e);
        throw e;
      }
    }
    return verdict(el, c as Computed<any> | null) as T;
  }

  if (typeof el._fn === "function") prepareComputed(el as Computed<unknown>, false);

  if (
    !el._fn &&
    el._x?._snapshotValue === undefined &&
    !snapshotCaptureActive &&
    (!unflushedStaged || el._pendingValue === NOT_PENDING) && // F-10, see readNodeFast
    !(el._config & CONFIG_OVERRIDE) && // lanes: the slow path's one arm
    (!__DEV__ || !strictRead)
  ) {
    if (__TEST__) shadowExpect(c as Computed<any> | null, el, tracking, 0, spectating, false);
    if (c) {
      if (laneStageHook) fresh = tracking && readsFresh(c as Computed<any>, el);
      if (tracking) link(el, c as Computed<any>);
      // A pass that reads a held value joins its hold, tracked or not (D-1): a
      // mainline derivation of a held write would tear (F-1). A first pass that
      // did is born held (F-7). Frame-only readers (D-29) and frame readers
      // (`frameRead`, D-25) see the committed value instead.
      if (el._config & CONFIG_HELD && !(c._config & CONFIG_CHILDREN_FORBIDDEN)) {
        if (frameRead(c as Computed<any>, el)) {
          if (__TEST__) shadowActual(SLOT_C);
          return el._value as T;
        }
      }
    }
    if (!c || el._pendingValue === NOT_PENDING || c._config & CONFIG_CHILDREN_FORBIDDEN) {
      if (__TEST__) shadowActual(SLOT_C);
      return el._value as T;
    }
    // Writes that netted are no proposal (D-8): not a read of the future, nor a
    // stale verdict read to re-run at the landing (#4485). `Object.is` too, for
    // signed zeros; `===` keeps an accepted NaN rewrite a proposal.
    const netted = el._pendingValue === el._value && Object.is(el._pendingValue, el._value);
    // Lane work over a folded lane, once the frame has a transaction, reads the
    // screen (D-34).
    if (
      netted ||
      (((observeFlightHook && c._config & CONFIG_VERDICT) || (laneStageHook && passLane?.folded)) &&
        stagedScreen(c as Computed<any>, el))
    ) {
      if (__TEST__) shadowActual(netted ? SLOT_P : SLOT_C);
      return el._value as T;
    }
    stagedRead(c as Computed<any>);
    if (__TEST__) shadowActual(SLOT_P);
    return el._pendingValue as T;
  }

  if (
    __DEV__ &&
    el._statusFlags & STATUS_PENDING &&
    ((strictReadActive() && strictRead) || (strictPending && el._parent === context))
  )
    throwPendingUntrackedRead(((strictReadActive() && strictRead) || strictPending) as string, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (el as any)?._name
    });

  // Decided after the pull below: a pull can join (D-25).
  let committed = false;
  // Only a re-read retries an errored source (F-9).
  let reread: unknown;
  if (c) {
    if (laneStageHook) fresh = tracking && readsFresh(c as Computed<any>, el);
    if (tracking) {
      reread = link(el, c as Computed<any>);
      if ((el as Computed<unknown>)._fn) {
        pullComputed(el, c as Computed<any>);
        // A memo over a verdict reader's value reads ahead as if it probed inline
        // (F-6, #4050). Not an effect, and not the hold's own work (born in its
        // world, or over its own staged pass): there a pending read throws (D-25,
        // #4504, #3884). The posture lasts until a pass completes having read no
        // verdict reader (D-25, #4408). A render effect never committed reading a
        // settled verdict reader's value reads ahead too (F-6, #4544).
        if (
          observeFlightHook &&
          ((c as Computed<any>)._statusFlags & STATUS_UNINITIALIZED
            ? c._config & CONFIG_HELD || flushTransaction
            : c._config & CONFIG_HELD_FRAME)
        ) {
          if (
            (c as any)._type === EFFECT_RENDER &&
            el._config & CONFIG_VERDICT &&
            !(el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED))
          )
            (c as Computed<any>)._flags |= REACTIVE_AHEAD;
          // A sync verdict memo is display while only the display reads it (D-25,
          // #4776). The hold's own work reading it makes it the hold's: it re-derives
          // now on the hold's writes (`holdStaging`). A memo that probes in its own
          // body stays the screen's (F-6, #4544). An async derivation's read seats
          // nothing (S-51): the lane and the mount it gates would wait on each other
          // (#4965).
          if (
            (el._config & (CONFIG_VERDICT | CONFIG_FRAME | CONFIG_ASYNC | CONFIG_OWN_PROBE)) ===
              CONFIG_VERDICT &&
            !(c._config & CONFIG_ASYNC)
          ) {
            const t = resolveTx(
                c._config & CONFIG_HELD ? txOf(c as Computed<any>) : flushTransaction!
              ),
              x = ext(el);
            if (x._readIn !== t) {
              x._readIn = t;
              recompute(el);
            }
          }
        }
        if (observeFlightHook && !(c as any)._type)
          (c as Computed<any>)._flags |=
            el._config &
            CONFIG_VERDICT &
            (el._statusFlags & STATUS_PENDING &&
            (c._config & CONFIG_STAGED || (c as Computed<any>)._statusFlags & STATUS_UNINITIALIZED)
              ? c._config
              : -1);
      }
    }
    if (__TEST__)
      shadowExpect(
        c as Computed<any>,
        el,
        tracking,
        0,
        spectating,
        snapshotCaptureActive &&
          ((c as Computed<any>)._config & CONFIG_IN_SNAPSHOT_SCOPE) !== 0 &&
          el._x?._snapshotValue !== undefined &&
          !(el._statusFlags & STATUS_ERROR)
      );
    // A node born into the future has no committed value: every reader derives
    // from the future, a render effect included (D-1, F-7).
    if (
      el._config & CONFIG_HELD &&
      !(el._config & CONFIG_OVERRIDE) &&
      !(c._config & CONFIG_CHILDREN_FORBIDDEN)
    ) {
      if (el._statusFlags & STATUS_UNINITIALIZED) joinPass(c as Computed<any>, el);
      else committed = frameRead(c as Computed<any>, el);
    }
  } else if (__TEST__) shadowExpect(null, el, tracking, 0, spectating, false);
  // After the pull, so the node is current. A pending member throws as any.
  if (laneReadHook && el._config & CONFIG_OVERRIDE) {
    const v = laneReadHook(c as Computed<any> | null, el);
    if (v !== NOT_PENDING) return v as T;
  }

  // Ahead of the snapshot serve: hydrating or not, a body's direct read is
  // wrong the same way (#3675).
  if (__DEV__ && strictRead && strictReadActive())
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (el as any)?._name
    });

  // A hydration claim is served the value the server rendered with, and
  // replays at the scope's release. An errored node still throws below.
  if (snapshotCaptureActive && c && (c as Computed<any>)._config & CONFIG_IN_SNAPSHOT_SCOPE) {
    const sv = el._x?._snapshotValue;
    if (sv !== undefined && !(el._statusFlags & STATUS_ERROR)) {
      const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
      const current = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (current !== snapshot) (c as Computed<any>)._flags |= REACTIVE_SNAPSHOT_STALE;
      if (__TEST__) shadowActual(SLOT_SNAPSHOT);
      return snapshot as T;
    }
  }

  // A stale reader of a held flight is served the committed value and does
  // not go pending (D-9, D-25); so is lane work reading a flight not its own
  // (D-25), and a verdict reader (`[isPending(x), x()]` is `[true, stale]` in
  // either order, D-23). Not a flight committed beneath inputs on screen
  // (F-1), nor a reader born into its transaction (#4010).
  if (
    laneStageHook &&
    el._statusFlags & STATUS_PENDING &&
    !committed &&
    !(el._config & CONFIG_OVERRIDE) &&
    !(el._statusFlags & STATUS_UNINITIALIZED)
  ) {
    // A verdict reader first, routed or not (D-25, #4661). A reader with no
    // committed value sees the flight pending, so a boundary a lane mounts
    // shows its fallback (F-7). A mount a probing pass opened is born held
    // (S-46, S-58).
    if (
      c !== null &&
      c._config & CONFIG_VERDICT &&
      !(c._config & CONFIG_MOUNT_AHEAD && (c as Computed<any>)._statusFlags & STATUS_UNINITIALIZED)
    )
      committed = observeFlightHook!(c as Computed<any>, el);
    else if (
      passLane !== null &&
      (!((c as Computed<any> | null)?._statusFlags! & STATUS_UNINITIALIZED) ||
        bornOfLaneRerun(c as Computed<any>))
    )
      // Lane work is served the committed value unless it read this flush's
      // staging (F-2, S-57).
      committed = laneServedHook!(c as Computed<any>, el, true) as boolean;
  }
  if (el._statusFlags & STATUS_PENDING && !committed) {
    // Untracked, an uninitialized node has nothing to serve and throws. A
    // frame-only reader sees the frame (D-29), and so does a ref callback's
    // own read: a ref is imperative, like an event handler (F-1, #5098).
    if (c) {
      if (__DEV__ && c._config & CONFIG_CHILDREN_FORBIDDEN) {
        const message =
          "[PENDING_ASYNC_FORBIDDEN_SCOPE] Reading a pending async value inside createTrackedEffect or onSettled serves the committed value (and throws while uninitialized). " +
          "Use createEffect instead which supports async-aware reactivity.";
        reportDiagnostic(
          emitDiagnostic(
            {
              code: "PENDING_ASYNC_FORBIDDEN_SCOPE",
              kind: "async",
              severity: "warn",
              message,
              ownerId: c.id,
              ownerName: (c as any)._name,
              nodeName: (el as any)?._name
            },
            c
          )
        );
      }
      if (
        !(c._config & CONFIG_CHILDREN_FORBIDDEN || (refCallbackDepth && !tracking)) ||
        el._statusFlags & STATUS_UNINITIALIZED
      ) {
        // Out of line, so `read` gains a call only where a pending read throws (D-22, F-9).
        if (observeFlightHook && servesStaged(c as Computed<any>, el, el)) {
          if (__TEST__) shadowActual(SLOT_P);
          return el._pendingValue as T;
        }
        // An untracked read of a pending node still re-runs its reader when it
        // settles, unless nobody reads (`spectating`, #3528) or it reads itself.
        if (!tracking && !spectating && el !== c) link(el, c as Computed<any>);
        if (__DEV__) noteThrownRead(el, el._x?._error);
        throw el._x?._error;
      }
    } else if (el._statusFlags & STATUS_UNINITIALIZED) {
      throw el._x?._error;
    }
  }
  // An errored derive throws for every reader, memo parity (D-41, #2897).
  if ((el as Computed<any>)._fn && (el as Computed<any>)._statusFlags & STATUS_ERROR) {
    // Only a re-read retries an errored source (F-9): tracked, by a pass whose
    // last pass read it (#5002), on a later cycle, and not by a zombie, whose
    // retry livelocked the live frame's readers (S-58, #4405).
    if (
      reread &&
      (el as Computed<any>)._time < clock &&
      !((el as Computed<any>)._flags & REACTIVE_ZOMBIE)
    ) {
      recompute(el as Computed<unknown>);
      if (__TEST__) shadowActual(SLOT_E);
      return read(el);
    }
    // A staged error is this flush's answer (D-41): a reader served the staging
    // throws it and stages its own; one served the screen throws the shown one
    // (#4404).
    if (!committed && el._config & CONFIG_STAGED_ERROR) serve(el, c as Computed<any> | null);
    if (__DEV__) noteThrownRead(el, (el as Computed<any>)._x?._error);
    throw (el as Computed<any>)._x?._error;
  }

  // A reader served the screen throws the shown error (D-41).
  if (committed || !c) throwShown(el);
  const value = serve(el, committed ? null : (c as Computed<any> | null)) as T;
  if (
    !c &&
    typeof el._fn === "function" &&
    el._config & CONFIG_AUTO_DISPOSE &&
    !(el._statusFlags & STATUS_PENDING) &&
    !el._subs
  ) {
    // Deferred: an inline unobserved() made consecutive untracked reads answer
    // differently with no write between (#3078). The flush sweep reclaims it.
    dormantNodes.add(el as Computed<unknown>);
    schedule();
  }
  return value;
}

/** A first pass a guess lane's re-run creates stands where the memo it
 * replaces stood, so lane work's read of a parent's flight is the screen's
 * for it too (#4824). A boundary's structure (F-7, #3835) and a mount a
 * display-ahead read opens (S-58, D-25) still see the flight. */
function bornOfLaneRerun(c: Computed<any>): unknown {
  const p = c._parent as Computed<any> | null;
  return (
    passLane!._parent?._verdict !== passLane &&
    p?._fn &&
    !((p._statusFlags & STATUS_UNINITIALIZED) | (p._config & CONFIG_FRAME))
  );
}

/** A reader served the screen reads a shown error until its replacement
 * commits (D-41). */
function throwShown(el: Signal<any> | Computed<any>): undefined {
  if (el._x?._shownError) {
    if (__DEV__) noteThrownRead(el, el._x._shownError);
    throw el._x._shownError;
  }
}

/** The value reader `c` (null: untracked) is served from `el`; read's fast
 * block keeps its trivial ternary for speed. */
export function serve(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  // A node born staged has no committed value: an untracked, bookkeeping or
  // frame-only reader has nothing to serve and holds (F-9, D-29). A ref born
  // into this node's hold reads it as the hold's own work (D-25, #4767); one
  // mounted outside must not see it ahead of the commit (F-7).
  if (
    el._pendingValue !== NOT_PENDING &&
    (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED &&
    (!c || spectating || c._config & CONFIG_CHILDREN_FORBIDDEN)
  ) {
    if (refCallbackDepth > 0) {
      const pass = creatorPass(context);
      if (pass && el._config & CONFIG_HELD && bornInto(pass, txOf(el))) {
        if (__TEST__) shadowActual(SLOT_P);
        return el._pendingValue;
      }
    }
    if (__DEV__) {
      const e = new NotReadyError(null);
      noteThrownRead(el, e);
      throw e;
    }
    throw new NotReadyError(null);
  }
  const u = c && unflushedStaged ? unflushedValue(el) : NOT_PENDING;
  if (u !== NOT_PENDING) {
    markLateLinker(c!);
    if (__TEST__) shadowActual(el._config & CONFIG_HELD ? SLOT_P : SLOT_C);
    return u;
  }
  if (
    readerSeesCommitted(el, c) ||
    (observeFlightHook &&
      c!._config & CONFIG_VERDICT &&
      !((el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED) &&
      stagedScreen(c!, el) &&
      !throwShown(el))
  ) {
    if (__TEST__) shadowActual(SLOT_C);
    return el._value;
  }
  // Writes that netted are no proposal (D-8, #4452), as in read's fast block.
  if (
    !(__DEV__ && strictRead) ||
    (el as Computed<any>)._fn ||
    el._pendingValue !== el._value ||
    !Object.is(el._pendingValue, el._value)
  )
    stagedRead(c!, el);
  if (el._config & CONFIG_STAGED_ERROR) {
    if (__DEV__) noteThrownRead(el, el._pendingValue);
    throw el._pendingValue;
  }
  if (__TEST__) shadowActual(SLOT_P);
  return el._pendingValue;
}

/** Shadow (seat.ts): run `read` once and compare the served slot with the
 * table's prediction. NotReady is NR, any other throw E. */
function shadowRead<T>(el: Signal<T> | Computed<T>): T {
  shadowEnter();
  let thrown = SLOT_NONE;
  try {
    return read(el);
  } catch (e) {
    thrown = e instanceof NotReadyError ? SLOT_NR : SLOT_E;
    shadowThrown(e);
    throw e;
  } finally {
    shadowLeave(thrown);
  }
}

/** A pass read a staging of this flush: the seam decides (D-25). Lane work
 * too: if the flush parks, the pass re-derives on the committed world and
 * its lane waits that round, so the held write never shows through it. A
 * folded lane only before the frame has a transaction (D-34). Not a node
 * born staged: a re-run would read the same staging every round (#3969). */
export function stagedRead(c: Computed<any>, el?: Signal<any> | Computed<any>): void {
  if (!((el as Computed<any> | undefined)?._statusFlags! & STATUS_UNINITIALIZED)) {
    // Lane work that was served a flight's committed value now reads a staging:
    // it throws (#4859).
    if (laneServedHook && passLane !== null) laneServedHook(c, null);
    c._flags |= REACTIVE_STAGED_READ;
    if (__TEST__) shadowExternalRaise(c, RAISE_FL);
    // A verdict effect's staging read is the frame's, re-derived once if the
    // flush parks (D-22, D-25). A memo is not a leaf (`frameRead`).
    if (laneSeamsHook && (passLane !== null || ((c as any)._type && c._config & CONFIG_VERDICT)))
      stagedReaders.push(c);
  }
}

/** A verdict reader's plain read of a staged node sees the screen once the
 * frame has a transaction, and re-derives at its landing (D-25, #3322).
 * Before that the seam answers. A node born into the future (F-7), a reader
 * born into the transaction (#4010) or into the hold (D-25) has no screen. */
export function stagedScreen(c: Computed<any>, el?: Signal<any> | Computed<any>): boolean {
  if (
    flushTransaction === null ||
    bornInto(c, flushTransaction) ||
    (el?._config! & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD ||
    // This flush's own write read by a pass with an inherited posture is the
    // frame's derivation (D-25, #4544).
    (observeFlightHook && holdStagingHook!(c, el))
  )
    return false;
  // The staging is the frame's read in the frame's seat; the seam re-derives
  // only if the flush parks (D-22, F-10). Content a display-ahead gate opens
  // is a mount (#4806), but not under the pass's own `isPending` window: a
  // read's place beside the probe never changes what shows (F-6, D-23, #4966).
  if (laneStageHook && el && fresh && passLane && c._flags >> WINDOW_KINDS != 1)
    passLane._opened = 1;
  staleReader(c, flushTransaction);
  return true;
}

export function ownedScopeWriteMessage(owner: Owner): string {
  const name = (owner as any)._name;
  return name
    ? `${REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE} (in ${name})`
    : REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE;
}

/** A write inside a recompute outside a flush is promoted at that pass's end. */
export function notePromotedWrite(el: Signal<any> | Computed<any>): void {
  if (globalQueue._running || el._config & CONFIG_PROMOTED) return;
  el._config |= CONFIG_PROMOTED;
  promotedWrites.push(el);
}

/** The first write during snapshot capture to a plain user signal records the
 * pre-write value. Async landings reveal, and projection leaves are their
 * compute's, so neither qualifies. */
export function captureWriteSnapshot<T>(el: Signal<T> | Computed<T>, current: T): void {
  if (
    el._config & CONFIG_NO_SNAPSHOT ||
    (el as Computed<T>)._fn !== undefined ||
    el._x?._snapshotValue !== undefined
  )
    return;
  takeSnapshot(el, current);
}

function takeSnapshot<T>(el: Signal<T> | Computed<T>, value: T): void {
  ext(el)._snapshotValue = value === undefined ? NO_SNAPSHOT : value;
  el._config |= CONFIG_HAS_SNAPSHOT;
  snapshotSources!.add(el);
}

/** Called before every signal or store write while set. The server-components
 * client mounts still-deferred slots before a write applies, then clears it. */
export let writeHook: ((node?: object) => void) | null = null;
/** @internal */
export function setWriteHook(hook: ((node?: object) => void) | null): void {
  writeHook = hook;
}

/** The one guarded comparator call. A comparator that read unresolved async
 * reports a change (#4111); any other throw is `el`'s error, routed to its
 * boundary and answered "same" (D-38, #2837).
 * @internal */
export function isSame(el: Signal<any>, a: unknown, b: unknown): unknown {
  if (el._equals === isEqual) return a === b;
  try {
    return el._equals && el._equals(a, b);
  } catch (e) {
    // A comparator's throw is `el`'s, not a catch in the running pass (D-42).
    if (__DEV__) forgetThrownRead();
    if (!(e instanceof NotReadyError))
      return (notifyStatus(el as Computed<any>, STATUS_ERROR, e), true);
  }
}

/** Observe: the async node landing through `setSignal`, and whether it passed
 * the equality gate. */
let landing: object | null = null;
let landed = false;

/** Observe: the landing reports this write as `asyncLanded`, not `write`. */
export function landThroughSetSignal(el: Computed<any>, value: unknown): boolean {
  // Saved, not reset: a nested landing must not clear the outer's.
  const outerLanding = landing;
  const outerLanded = landed;
  landing = el;
  landed = false;
  try {
    setSignal(el, () => value);
    return landed;
  } finally {
    landing = outerLanding;
    landed = outerLanded;
  }
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  if (writeHook !== null) writeHook(el);
  if (
    __DEV__ &&
    !(el._config & CONFIG_OWNED_WRITE) &&
    !(context && context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    context &&
    !disposalDepth &&
    !inRefCallback()
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
    throw new Error(ownedScopeWriteMessage(context));
  }

  const currentValue = el._pendingValue === NOT_PENDING ? el._value : (el._pendingValue as T);

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  // A write landing on a guess is its truth (F-11); one on a lane's
  // derivation is the lane's staging.
  if (laneWriteHook && el._config & CONFIG_OVERRIDE) return laneWriteHook(el, v);
  // A write to a held slot is a second proposal: the writer's tick joins the
  // hold, before the equality gate (D-8).
  if (el._config & CONFIG_HELD) joinFuture(txOf(el));
  // The first commit has no previous value: the comparator never sees
  // `undefined`. A write over a shown error is a change (D-41). `custom` is
  // taken once for the gate and the netting so the default `===` runs inline
  // (CodSpeed `propagation: avoidable`); without the engine it is `null` and
  // the netting folds away.
  const custom = observeFlightHook ? el._equals !== isEqual : null;
  const valueChanged =
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED) ||
    !!el._x?._shownError ||
    (custom === false ? currentValue !== v : !isSame(el, currentValue, v));
  if (!valueChanged) return v;

  // Observe: a committed write begins a re-run chain; a landing reports itself.
  if (__OBSERVE__ && attrHooks !== null) {
    if (el === landing) landed = true;
    else attrHooks.write(el, currentValue, v);
  }

  // A write during snapshot capture to a source created before capture
  // captures the pre-write value now, so claims keep the server's value and
  // replay at release. Store leaves qualify too.
  if (snapshotCaptureActive) captureWriteSnapshot(el, currentValue);

  const wasStaged = el._pendingValue !== NOT_PENDING;
  if (!wasStaged) queuePendingNode(el);
  // F-10: a held node rewritten outside a flush keeps its flushed staging.
  else if (el._config & CONFIG_HELD && !globalQueue._running) stashFlushed(el);
  // A staged rewrite equal to the committed value nets to it (D-8, #4483).
  // Only the verdict engine reads the netting; under the default comparator
  // `v` already is the committed object.
  el._pendingValue =
    custom &&
    wasStaged &&
    !((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED || el._x?._shownError) &&
    isSame(el, el._value, v)
      ? el._value
      : v;
  // A cold helper keeps setSignal within every setter's inlining budget.
  if (__DEV__) devTrackHeldPending(el);
  if (context !== null) notePromotedWrite(el);

  // `_time` is computed-only: writing it on a signal forks the lean shape.
  if ((el as any)._fn !== undefined) el._time = clock;
  // A re-write whose subscribers were walked with nothing recomputed or linked
  // since re-stages and stops: the walk is idempotent.
  if (wasStaged && el._notifiedAt === notifyEpoch) return v;
  insertSubs(el);
  schedule();
  return v;
}

/** User-facing setter for the memo form of `createSignal(fn)`. The write
 * stages like any other, and a later source change re-derives with it as
 * `prev` (D-8, CS-R31). REACTIVE_MANUAL_WRITE marks it a user proposal until
 * a pass re-derives it or the commit lands it. */
export function setMemo<T>(el: Computed<T>, v: T | ((prev: T) => T)): T {
  // Is `el`'s staging a derivation another transaction holds? Then a setter
  // composes on the committed frame it was written against and becomes `prev`
  // for the hold's re-derivation (D-8, #3612).
  const held =
    el._config & CONFIG_HELD &&
    !(el._flags & REACTIVE_MANUAL_WRITE) &&
    txOf(el) !== flushTransaction;
  if (held && typeof v === "function") {
    const value = (v as (prev: T) => T)(el._value);
    v = () => value;
  }
  // A write replaces a failed derivation's outcome without re-running `_fn`,
  // so clear STATUS_ERROR here (#4110). The error shows until the write
  // commits (D-41).
  if (el._statusFlags & STATUS_ERROR) {
    el._x!._shownError = el._x!._error;
    notifyStatus(el, STATUS_NONE);
  }
  v = setSignal(el, v);
  // A write replaces a staged error (D-41).
  el._config &= ~CONFIG_STAGED_ERROR;
  if (held) {
    // The staging it replaced came from inputs the writer never saw: the hold
    // re-derives over the write (D-8).
    el._flags = (el._flags & ~REACTIVE_CHECK) | REACTIVE_DIRTY;
    insertIntoHeap(el, dirtyQueue);
    schedule();
  } else if (el._pendingValue !== NOT_PENDING) el._flags |= REACTIVE_MANUAL_WRITE;
  return v;
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
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "RUN_WITH_DISPOSED_OWNER",
          kind: "owner",
          severity: "warn",
          message,
          ownerId: owner.id,
          ownerName: (owner as any)._name
        },
        owner
      )
    );
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

/** Core half of `refresh()` (signals.ts): marks the next recompute a quiet
 * re-ask and schedules it. `check`: the owned-scope check alone, the mark
 * coming after the answer out lands (#5094). */
export function markRefresh(node: Computed<any>, check?: boolean): void {
  if (
    __DEV__ &&
    context &&
    !((node._config ?? 0) & CONFIG_OWNED_WRITE) &&
    !(context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    !disposalDepth &&
    !inRefCallback()
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
  if (!check && typeof node._fn === "function" && !(node._flags & REACTIVE_DISPOSED)) {
    // A refresh in a manual write's frame re-asks with the write as `prev`
    // (D-8, #3026). The next pass's flight is a quiet re-ask (F-9), unless an
    // input changed this tick.
    node._flags =
      (node._flags & ~REACTIVE_CHECK) |
      REACTIVE_DIRTY |
      (node._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP) ? 0 : REACTIVE_REASK);
    // Observe: a refresh is a root cause; the run points here.
    if (__OBSERVE__ && attrHooks !== null) attrHooks.refreshed(node);
    insertIntoHeap(node, dirtyQueue);
    schedule();
  }
}
