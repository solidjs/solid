import { checkForeignRead, enterCopy, exitCopy } from "./copies.js";
import {
  clearStatus,
  handleAsync,
  notifyStatus,
  parkLoadingWindow,
  releaseFlightTeardown,
  releaseIfSettledUnobserved,
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
  REACTIVE_REASK,
  REACTIVE_STAGED_READ,
  REACTIVE_NONE,
  REACTIVE_JOINED,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_NONE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
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
  markNode
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
// The reader seat's shadow (S0): reachable only under `__TEST__`
// (documentation/plans/reader-seat-rebuild.md §3).
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
  inEffectCallback,
  effectCallbackEvent,
  ANY_EVENT,
  passTx,
  joinPassTx,
  stagedReaders,
  latestOpened,
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
  holdWorkHook,
  laneWriteHook,
  observeFlightHook,
  wireExternalSourceHook
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

// The heap's per-node step. A tracked effect's heap visit is its compute
// phase — empty, like a user effect whose compute reads nothing — and hands
// the callback to the user queue. Routing the wake through the heap, rather
// than straight into the queue at notify time, is what orders the run after
// the commit regardless of which phase the write came from: a write in a
// render-effect callback stages its value for the next pass, but a wake pushed
// directly into the user queue ran in the SAME pass, read the old value, and
// nothing re-notified it when the value landed (#3291).
GlobalQueue._update = el => {
  if ((el as any)._type === EFFECT_TRACKED) {
    deleteFromHeap(el, dirtyQueue);
    (el as any)._modified = true;
    globalQueue.enqueue(EFFECT_USER, (el as any)._run);
  }
  // L2: a zombie's fate is the seam's — its owner's commit disposes it, or
  // the park cancels the pass (the write that dirtied it is held). It runs
  // only past a seam that left it alive (a live write to a frame whose
  // owner is held in the future). Its lane's own re-staging is a live write
  // (REACTIVE_LANE_DIRTY — a lane shows ahead of any park): it runs now, as
  // the lane's work, for the reveal this seam (#3463).
  else if (el._flags & REACTIVE_ZOMBIE && !(el._flags & REACTIVE_LANE_DIRTY)) deferZombie(el);
  // A lane frame's member (parked by a lane pass, #3698) follows mainline
  // writes only: a lane's dirty on it is cancelled — the lane's apply retires
  // it, and the pass that replaced it already decided what that screen shows
  // (#4137: a `<Show>` branch withdrawn by its own lane re-ran on a falsy
  // condition).
  // (Lanes exist only with the lane engine installed: folded away without.)
  else if (laneStageHook && el._flags & REACTIVE_ZOMBIE && laneFrameMember(el)) {
    deleteFromHeap(el, dirtyQueue);
    el._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_LANE_DIRTY);
  } else recompute(el);
};
/** The zombie's frame was parked by lane work: the nearest non-zombie owner
 * (the one whose pass parked it) carries a lane's derived value — or, an
 * effect (no lane value: `laneStage`), is listed in a lane (an `insert()`
 * hole's render effect). */
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
/** Dev: the effect phase (render and user effects, their cleanups) runs with
 * no ambient owner, and a computation created there with none is outside
 * every owner and every hold (maintainer, 2026-10-01: ownerless only —
 * `runWithOwner` in a callback is deliberate, Portal and createReaction do
 * it; a bare createRoot is the mistake). Computeds and roots; a signal
 * created there is inert and harmless. Tracked effects and onSettled are
 * children-forbidden and refuse through PRIMITIVE_IN_FORBIDDEN_SCOPE. */
export function assertNotInEffectCallback(): void {
  if (
    inEffectCallback &&
    context === null &&
    (effectCallbackEvent === ANY_EVENT || dispatchingEvent() === effectCallbackEvent)
  ) {
    emitDiagnostic({
      code: "PRIMITIVE_IN_EFFECT_CALLBACK",
      kind: "lifecycle",
      severity: "error",
      message: PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE
    });
    throw new Error(PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE);
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
/** The lane at the root of the running chain of first passes: the lane whose
 * pass created the chain's first node (a mount), inherited by every first
 * pass nested under it, whose seats are mainline (`recompute`, #4166). */
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

/**
 * Marks `owner` a snapshot scope: while capture is on, the readers created
 * under it serve each source's snapshot (the value it had when hydration
 * began) and replay at `releaseSnapshotScope`.
 *
 * With `served` (hydration), `owner` is instead a hydrated computed and
 * `served` its server answer — what the server rendered every reader of the
 * node with — landing after the node was created pending (so the creation
 * arm skipped it). It becomes the node's snapshot when it has none, whether
 * the node committed the answer or a client write had already taken its
 * compute over. A claim made later reads the value its markup shows, and
 * replays the node's own value at its release, as for a written signal.
 */
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
      // The extension is a fixed-shape object with `_snapshotValue`
      // pre-initialized to undefined (see ext()), and every reader tests
      // `!== undefined` — assign, don't `delete`: deleting a field pushes the
      // object to dictionary mode for every later read of every field.
      const x = source._x;
      if (x != null) x._snapshotValue = undefined;
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}

export function recompute(el: Computed<any>, create: boolean = false): void {
  // §12d: any recompute can clean a marked subscriber — invalidate skips.
  bumpNotifyEpoch();
  const isEffect = (el as any)._type;
  let released: Computed<any>[] | undefined;
  // Lanes (plan sec. 28): the seat of a pass is its node's. A node carrying a lane's
  // derived value runs as the lane's whoever dirtied it — a sync write, a
  // boundary reset, a frame rerun — so its children and its result are the
  // lane's; so does a member the lane's own re-staging dirtied
  // (REACTIVE_LANE_DIRTY, lanes.ts — a leaf the lane owns). A written guess's
  // own pass is its truth arriving (A18), the frame's. A first pass is its
  // creator's (ruling A: a lane pass's children are the lane's frame), and
  // under a guess's lane it reads as the lane's too — a binding the lane
  // mounts sees the screen, like the pass that mounted it (#3835). Not
  // under a verdict lane, for its reads or its result: a verdict lane holds
  // verdicts, and a mount it makes is a mainline mount (A29's boundary
  // exemption, #3851). A tracked read of a lane's value moves a
  // derivation's pass into the lane (`read`); a leaf's never moves.
  // Restored at the end, after this pass's staging and runs have been
  // routed.
  // Lanes exist only with the lane engine installed (`laneStageHook`): a
  // bundle without it seats every pass on mainline (`passLane` is never set)
  // and folds the seat, and its restores, away.
  const prevLane = passLane;
  // The mount a first pass belongs to: its creator's lane, or the one its
  // creator's own mount came from — a render effect a verdict lane's mount's
  // content creates is that mount's too (#4166). Lanes only, like the seat.
  const prevMount = laneRoot;
  const mount = laneStageHook && (laneRoot = create && (prevLane || prevMount));
  // Shadow seat (S0): the node's own lane, as the seating below spells it.
  const shadowOwnLane = __TEST__
    ? (el._flags & REACTIVE_LANE_DIRTY ||
        (el._config & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE) &&
      el._x?._transaction?._lane
      ? el._x._transaction
      : null
    : null;
  if (laneStageHook)
    setPassLane(
      (el._flags & REACTIVE_LANE_DIRTY ||
        (el._config & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE) &&
        el._x?._transaction?._lane
        ? el._x._transaction
        : // Loose `!=`: false with no creator lane (undefined == null).
          create &&
            prevLane?._parent!._verdict != prevLane &&
            (creatorPass(context)?._flags as number) & REACTIVE_RECOMPUTING_DEPS
          ? prevLane
          : null
    );
  // Attribution hook: fired before this run touches the dep list — `_deps`
  // still holds the previous run's links (the subscriptions that could have
  // triggered this run, and the baseline for the engine's subscription diff).
  let devChanged = false;
  if (__OBSERVE__) {
    (el as any)._devWindows = 0;
    if (attrHooks !== null) attrHooks.recomputeStart(el, create);
  }
  // CARVE 2: lane posture resolution (OPTIMISTIC_DIRTY, derived-override
  // re-derivation, lane adoption through deps) went with the optimistic engine.
  // An error a pass staged, which this pass replaces (`valueChanged`).
  const replaced = el._config & CONFIG_STAGED_ERROR;
  if (!create) {
    deleteFromHeap(el, dirtyQueue);
    // A pending flight is the transition's own work (#3884), and so is a
    // held async memo's re-run with no verdict window of its own (D-25,
    // `holdWork`): a pass that takes no verdict role this time. A probe on
    // an earlier pass left CONFIG_VERDICT, and a frame read here would serve
    // the committed screen, settle the flight and drop the hold — a
    // superseding write's verdict would depend on that probe. Cleared for
    // this pass, before the flight it judges by is superseded; a probe in
    // the body re-stamps it after the plain reads. Not an effect: it has no
    // flight of its own (its pending is a source's), and a verdict memo's
    // change may have just made it a verdict reader (`laneDirty`). Only a
    // build with the lane engine (`laneStageHook`; verdict.ts imports it)
    // ever sets CONFIG_VERDICT: without it the line folds away.
    if (
      laneStageHook &&
      !isEffect &&
      (el._statusFlags & STATUS_PENDING ||
        (el._config & (CONFIG_ASYNC | CONFIG_HELD)) === (CONFIG_ASYNC | CONFIG_HELD))
    )
      el._config &= ~CONFIG_VERDICT;
    if (el._x !== null) {
      // The seam's re-derive runs with the parked flight still current; any
      // later pass asks its own question (`_parked`; only the lane engine
      // parks one).
      const p = laneStageHook && el._x._parked;
      if (p && p !== el._x._inFlight) el._x._parked = undefined;
      el._x._inFlight = null;
      // Supersede is where an iterator flight dies (#3122): close it now.
      // Idempotent with the cleanup-channel close.
      releaseFlightTeardown(el);
    }
    // L2: a pass over a held derivation joins its transaction — the
    // propagation that reached this node reached the transaction, and this
    // pass's answer replaces the held one there. A node held with nothing
    // staged — pending when its flush parked, or a member of a held frame —
    // joins all the same. Not a render effect (rule 3): it is the frame.
    // Re-run outside its transaction's flush it publishes mainline — the
    // value it staged there is superseded (`frameRead` remembers it for the
    // landing). A frame born into the transaction (`bornInto`: never run,
    // A29, or mounted by a pass of it still awaiting its commit, #4010) keeps
    // staging: live writes keep it current, it effects at the swap (ruling
    // A).
    // A boundary's structure (CONFIG_FRAME) is the frame like a render
    // effect: it publishes mainline outside its transaction's flush (#4283).
    if (el._config & CONFIG_HELD) {
      const tx = txOf(el);
      // Held by a blocked lane: the frame joins nothing — a lane never holds
      // a sync write (#3460). The pass is the lane's if it reads the lane's
      // world (`read`), and has left it otherwise.
      // An answered deferred node's re-pass is a lagging question (D-40):
      // it joins nothing, so the write that reached it commits mainline.
      // `EFFECT_RENDER << 23` is CONFIG_FRAME (a render effect, a boundary's
      // tree and output), spelled from the effect type as at creation.
      // A verdict reader born into `tx` (`bornInto`: never committed) is the
      // hold's own work, whatever it asked before (D-25): it joins like any
      // held pass, so what it mounts is the hold's (D-13, #4467).
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
        // Published mainline, it is not held: the frame this pass builds is
        // replaced on the spot (#3404) — this flush's commit retires the
        // committed frame the held pass had parked (`commitPendingNode`),
        // after the new frame's first runs, and the held pass's own
        // children die below (`disposeChildren`). The landing re-derives a
        // fresh held frame for the reveal (`_reruns`).
        // Not held any more, whichever frame reader it is: its readers read
        // the value this pass publishes — those that read the staging it
        // supersedes re-derive, even when it publishes the committed value
        // back (no change to notify them by): their held runs carry the
        // superseded frame, and the landing would apply them (#4378).
        if (el._pendingValue !== NOT_PENDING) insertSubs(el);
        el._pendingValue = NOT_PENDING;
        el._config &= ~CONFIG_HELD;
      }
    }
    // The previous pass's frame. If that pass is still awaiting its commit
    // (CONFIG_STAGED) its children were never shown and die on the spot — the
    // frame parked before it stays parked. Otherwise they ARE the frame:
    // park them until this pass commits. Tracked effects run after the seam
    // and own nothing to park.
    if (isEffect === EFFECT_TRACKED || el._config & CONFIG_STAGED) {
      // A lazy node only those children read is released when this pass
      // ends, if the pass doesn't read it again (#4142). A cleanup or
      // `unobserved` hook that throws here neither stops the pass nor skips
      // that drain: its error is rethrown when the flush ends (owner.ts).
      const prev = deferredReleases;
      deferReleases((released = []));
      disposeChildren(el);
      deferReleases(prev);
    } else if (el._firstChild !== null || el._disposal !== null) parkChildren(el);
    // An error a pass staged (D-41) is replaced by this pass's answer: a
    // value, a flight, or an error of its own (#4109, #4145).
    if (el._config & CONFIG_STAGED_ERROR) {
      el._pendingValue = NOT_PENDING;
      el._config ^= CONFIG_STAGED_ERROR;
    }
    if (__DEV__) clearSignals(el);
  }

  const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);
  // Capture both error and pending status before the compute clears them.
  // A conditional can drop its pending source and recover to an unchanged
  // value, leaving blocked dependents outside that source’s settle walk.
  const outgoingError = el._statusFlags & STATUS_ERROR && el._x?._error;
  const wasPending = (el._statusFlags & STATUS_PENDING) !== 0;
  const outgoingPendingSources = wasPending && el._x?._pendingSources;
  // Pending SOURCE-hood, captured before the compute clears status: a node
  // whose own flight parked dependents self-registers in _pendingSources
  // (notifyStatus, isSource). If this recompute supersedes that flight and
  // settles synchronously, those dependents settle HERE — asyncWrite's
  // settlePendingSource walk never runs for a landing that was preempted
  // (#3181).
  const wasPendingSource = el._x?._pendingSources?.has(el);
  // D-41: this pass's error is staged, not published (`stageError`).
  let stagedErr = false;
  // A19 exc. 2: a `refresh()` re-asks the question already answered — quiet
  // for the verdict — unless the question in flight is a new one, which the
  // re-ask does not launder (a poll during a quiet confirm stays quiet).
  // Nor a guess's new question whose answer is still held (#4336: an
  // action's refresh after an outside input change has not committed it).
  const reask =
    (el._flags & REACTIVE_REASK) !== 0 &&
    !(
      (el._statusFlags & STATUS_PENDING || (guessing && el._pendingValue !== NOT_PENDING)) &&
      el._x !== null &&
      !el._x._reask
    );

  // Shadow seat (S0): opened beside the seating at the head — after the
  // held re-pass arm above, which is the pass's own hold work — and
  // compared to it (documentation/plans/reader-seat-rebuild.md §3.2).
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
  // REACTIVE_ZOMBIE is position: it says the node sits on its owner's parked
  // frame, and the splice/reawaken paths key off it. A zombie reruns for
  // live writes until the commit that disposes it, so every per-pass wipe
  // — here, the finally below, updateIfNecessary — carries it (#3543).
  el._flags = REACTIVE_RECOMPUTING_DEPS | (el._flags & (REACTIVE_ZOMBIE | REACTIVE_REASK));
  el._time = clock;
  // The pass's previous value: its staging, else a lane node's lane value
  // when it has one (lanes.ts), else the committed one.
  let value =
    el._pendingValue !== NOT_PENDING
      ? el._pendingValue
      : el._config & CONFIG_OVERRIDE && el._x!._lane !== NOT_PENDING
        ? el._x!._lane
        : el._value;
  let oldHeight = el._height;
  let missedWake = false;
  // L2: did this pass read the future (REACTIVE_JOINED, set by read) — or,
  // a lane's mount, a staging of this flush (#3851, #4166)?
  let joined = false;
  let prevTracking = tracking;
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = strictRead;
    strictRead = false;
  }
  const prevCopy = __DEV__ ? enterCopy() : undefined;
  tracking = true;
  const isStaleEffect = isEffect && isEffect !== EFFECT_USER;
  const prevStale = stale;
  if (isStaleEffect) stale = true;
  // D-42 (dev): whatever an earlier pass of this node left recorded is not
  // this pass's; `checkCaughtRead` below judges this pass's body alone.
  if (__DEV__) clearThrownRead(el);
  try {
    // (The CONFIG_SYNC fast arm is prod-only: a dev build takes the general
    // arm for every node, so the D-42 check there sees sync nodes too.)
    if (!__DEV__ && el._config & CONFIG_SYNC) {
      value = el._fn(value);
      if (el._x !== null) el._x._inFlight = null;
      el._loading = false;
    } else {
      // A projection's body self-registers its flight through handleAsync
      // (with the commit as setter): its undefined return is not a sync
      // answer, and the outer handleAsync must not clobber the registration.
      const prevInFlight = el._x?._inFlight;
      const fnResult = el._fn(value);
      const isAsyncResult = typeof fnResult === "object" && fnResult !== null;
      const selfRegistered = el._x?._inFlight !== prevInFlight;
      // D-42 (dev): the body returned after a reactive read threw into it —
      // the catch around that read ran and swallowed (CAUGHT_REACTIVE_READ),
      // unless what returned is the flight the throw became (async.ts judges
      // that at its settle). Before handleAsync: a pending flight throws out.
      if (__DEV__) checkCaughtRead(el, selfRegistered ? el._x!._inFlight : fnResult);
      value = selfRegistered || !isAsyncResult ? fnResult : handleAsync(el, fnResult);
      if (!selfRegistered && !isAsyncResult) {
        if (el._x !== null) {
          el._x._inFlight = null;
          if (holdWorkHook) el._config &= ~CONFIG_ASYNC;
        }
        // A sync (non-object) return is the first real answer; async-shaped
        // results clear inside handleAsync at their own landing points, and a
        // self-registered flight clears when its own handleAsync lands.
        el._loading = false;
      }
    }
    // On a status-free node clearStatus is a guaranteed no-op: every field
    // its body gates on is either _statusFlags or lives in the cold
    // extension — no extension, no status to clear. (_x from an unrelated
    // installer just makes clearStatus a cheap re-verified no-op.)
    if (el._statusFlags !== 0 || el._x !== null) clearStatus(el, create);
  } catch (e) {
    const notReady = e instanceof NotReadyError;
    // An error answers, and so does a loading window's unready read (D-25,
    // verdict.ts `holdWork`): no flight is its own. A pass left pending
    // keeps the last answer's. (Kept by the verdict engine alone.)
    if (holdWorkHook && (!notReady || el._loading)) el._config &= ~CONFIG_ASYNC;
    if (notReady && el._loading) {
      // Loading window with an unready sync dependency: register for the
      // source's settle (the settlePendingSource walk runs off
      // _pendingSources + _blocked alone) but take NO read-visible pending
      // status and no downstream propagation — the committed loading value
      // keeps serving. If the
      // node is currently errored the error stays the answer until this
      // retry can actually run.
      parkLoadingWindow(el, e as NotReadyError);
    } else {
      // D-41: a pass of a held node, or one that read a staging of this
      // flush, stages its error (`stageError`).
      if (notReady || !(stagedErr = stageError(el, e, true))) {
        if (notReady) ext(el)._blocked = true;
        notifyStatus(el, notReady ? STATUS_PENDING : STATUS_ERROR, e);
        // The replacement source is fully propagated now. If no new flight
        // re-owned self, retire the superseded flight and its dependent copies.
        if (notReady && wasPendingSource && !el._x?._inFlight) settlePendingSource(el);
      }
      // A re-park drops what the earlier pass carried (#3456): a source this
      // pass no longer reaches — its branch switched, or a fresh flight
      // replaced the inputs' pending with its own — stays copied onto
      // dependents that reached it only through here, and its landing walk
      // stops at this node (nothing left to retire) before it finds them. A
      // dependent then waits forever on a flight it has no path to. The
      // re-park twin of the unchanged-value recovery sweep below; dependents
      // with another path keep the source (retryReaches). A staged error
      // answered what the pass carried: the same.
      if ((notReady || stagedErr) && outgoingPendingSources)
        for (const source of outgoingPendingSources)
          if (source !== el && !el._x?._pendingSources?.has(source))
            settlePendingSource(el, source);
    }
  } finally {
    tracking = prevTracking;
    if (laneStageHook) laneRoot = prevMount;
    if (__DEV__) {
      strictRead = prevStrictRead;
      exitCopy(prevCopy);
    }
    if (isStaleEffect) stale = prevStale;
    // Consume the missed-wake latch (#3037, set by insertSubs): a dep write
    // landed beneath this pass on a link it had already validated. The wipe
    // below must not key off DIRTY/CHECK — the read-time pull protocol
    // (markNode(c) in read()) marks the running node as part of ordinary
    // bookkeeping, and those marks are correctly discarded here.
    missedWake = (el._flags & REACTIVE_MISSED_WAKE) !== 0;
    // A mount's staged read joins it — except a nested derivation left
    // pending: no render effect reaches it yet, so it holds nothing and
    // reaches no boundary (Reader, #4203), whatever it read — a memo the
    // mount bore held over the staging included, at any depth (#4340). A
    // reader that does is caught.
    joined = !!(
      el._flags &
      (mount
        ? prevLane || isEffect || !(el._statusFlags & STATUS_PENDING)
          ? REACTIVE_JOINED | REACTIVE_STAGED_READ
          : 0
        : REACTIVE_JOINED)
    );
    // Shadow seat (S0): the born-held decision beside the old one, then
    // the seat is restored.
    if (__TEST__) shadowSeatClose(el, !!isEffect, joined, creatorPass(oldcontext), mount);
    // A verdict reader is one for as long as it probes, or reads a memo
    // that does (`read`): a pass that did neither (REACTIVE_PROBED, the same
    // bit) is an ordinary derivation again. Its async posture is the
    // verdict engine's to keep (CONFIG_ASYNC, verdict.ts `holdWork`, D-25).
    // (Only the verdict engine probes: without it the line folds away.)
    if (observeFlightHook)
      el._config = (el._config & ~CONFIG_VERDICT) | (el._flags & REACTIVE_PROBED);
    // REACTIVE_DISPOSED survives too (#3621): the pass may have disposed its
    // own owner (a memo calling its root's `dispose()`, a cleanup doing so
    // #3601/#3606), and `disposeChildren` set the flag on this node
    // reentrantly. Dropped, the node read as live — `refresh()` re-ran it
    // and `isDisposed()` lied. REACTIVE_FRAME_READ (A15 stale reader) is
    // this pass's verdict for the landing; the next pass's wipe at the top
    // clears it.
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
    // A19 exc. 2: a pass that went pending on a `refresh()` re-asks the
    // question already answered — quiet for the verdict; any other pending
    // pass is a new question. Settled, there is nothing to classify.
    if (el._x !== null) el._x._reask = reask && (el._statusFlags & STATUS_PENDING) !== 0;
  }

  // A node that died during its own pass (#3621) is dead at the end of it,
  // and the pass is void. Its owner's teardown already unlinked its deps,
  // removed it from the heap and ran its cleanups; what remains is what the
  // body did AFTER the `dispose()` call: reads that re-linked the dead node
  // to its sources (unlinked here — the leak that kept it re-running in a
  // torn-down tree), a flight it may have started (retired: the landing
  // checks `_inFlight` identity), and the value it returned. That value is
  // NOT published: a dead node freezes at its last committed value (#3024),
  // so nothing is staged, committed, or propagated to subscribers, and an
  // effect's run is not enqueued (runEffect would refuse it anyway). The
  // attribution frame opened at the top is still closed.
  if (el._flags & REACTIVE_DISPOSED) {
    clearDeps(el);
    if (el._x !== null) el._x._inFlight = null;
    if (__OBSERVE__ && attrHooks !== null)
      attrHooks.recomputeEnd(el, create, false, false, false, false);
    if (laneStageHook) setPassLane(prevLane);
    return;
  }
  // The lane this pass is work of, if any: its seat (the node's, its
  // creator's, or the one a lane read moved it into). A pass in a lane's
  // seat that read none of the lane's world has left it: its result is the
  // frame's (a derivation whose branch no longer reaches the guess). A
  // guess is written, not derived — it never leaves this way.
  let lane = !laneStageHook ? null : passLane;
  // Listed before its staging, a pending pass included (the lane's own
  // flight is the lane's); false: the pass left the lane (lanes.ts).
  const errored = !!el._x?._error || stagedErr;
  if (laneStageHook && lane !== null) {
    if (laneStageHook(el, lane, create, errored)) setPassLane(lane);
    else lane = null;
  }

  if (!errored) {
    // Observe-tier fan-in (HUGE_FAN_IN): the validated prefix [_deps.._depsTail]
    // IS this pass's distinct sources — count it here rather than per link. A
    // begin/end bracket around the pass plus a per-link increment measured
    // -5.8% on createRenderEffects:create1to1 (CodSpeed, dev tier) and cost
    // several points of the shape wins elsewhere; this walk is a fraction of
    // the reads that built the list and keeps no module state, so nested
    // pulls need no save/restore. (The stale tail is trimmed at the end of
    // this pass, or at its commit — see recompute's tail.)
    if (__OBSERVE__) {
      let fanIn = 0;
      for (let d = el._deps; d !== null; d = d._nextDep) {
        fanIn++;
        if (d === el._depsTail) break;
      }
      if (fanIn >= GRAPH_SIZE_WARN_AT) noteFanIn(el, fanIn);
    }
    // INV-11 (#3330): the equality gate compares against the slot this run
    // publishes to — the staged `_pendingValue` when staged; a lane node's
    // lane value (a node entering the lane this pass has none yet — its
    // committed value, `laneStage` having voided a frame staging).
    const compareValue =
      el._pendingValue !== NOT_PENDING
        ? el._pendingValue
        : el._config & CONFIG_OVERRIDE && el._x!._lane !== NOT_PENDING
          ? el._x!._lane
          : el._value;
    // A throwing comparator is contained inside `isSame` (A3, #2837; #4111).
    // A pass replacing an error this node staged is a new answer, even the
    // committed value (D-41: a recovery equal to the last good value is a
    // change): the slot it publishes to held the error, and the readers that
    // derived from it — `latest()` throws it — re-derive (#4403).
    const valueChanged =
      (!isEffect && wasUninitialized) ||
      !!el._x?._shownError ||
      !!replaced ||
      !isSame(el, compareValue, value);

    // A committed derived change becomes a cause for this node's subscribers,
    // chaining their attribution through this node to the root write.
    if (__OBSERVE__ && attrHooks !== null) {
      devChanged = valueChanged && !el._x?._error;
      if (devChanged && !isEffect && !create) attrHooks.derivedChanged(el);
    }

    // Effects use `_equals: false` (no per-effect closure). The side effects that
    // the equals closure used to perform — flagging the effect dirty and enqueueing
    // its runner — happen here instead. `!create` matches the previous `initialized`
    // gate: the explicit recompute(node, true) inside effect() does not enqueue, so
    // effect() can call its runner synchronously for the first run.
    if (
      isEffect &&
      valueChanged &&
      // A stale reader of a lane (REACTIVE_SCREEN_READ) that computed what it
      // last applied owes no run (lanes.ts).
      !(
        el._flags & REACTIVE_SCREEN_READ &&
        !(el as any)._modified &&
        Object.is((el as any)._prevValue, value)
      ) &&
      // A re-staging pass owes no run: the commit replays the effect (#3802).
      el._pendingValue === NOT_PENDING
    ) {
      (el as any)._modified = !el._x?._error;
      // Reuse one bound runner per effect — runEffect no-ops on a stale
      // `_modified`, so re-enqueueing the same function is harmless.
      // Lane work's run is the lane's (released at its reveal) — a first
      // pass under a lane too: `effect()` skips the synchronous first run of
      // a lane's node.
      if (!create || lane !== null)
        globalQueue.enqueue(
          isEffect,
          ((el as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, el)),
          lane
        );
    }

    // Lanes. A written guess's own pass from the frame: its source
    // recomputed it — the truth (A18: "the source is whatever recomputes the
    // node"). It stages under the lane's parent whether or not it changed (a
    // confirm is a landing too — the lane's end commits it) and notifies
    // only a correction: an equal truth re-runs nothing (lanes.ts). (As the
    // lane's own work the lane judged it — `laneStage`.)
    // (The hook first: a build without lanes folds the arm away.)
    if (
      laneOutcomeHook &&
      !create &&
      lane === null &&
      el._config & CONFIG_GUESS &&
      laneOutcomeHook(el, value, errored)
    ) {
      // The truth, staged under the lane's parent.
    } else if (errored) {
      // Comparator threw: skip the commit — the node is now errored and the
      // status propagation above owns downstream notification.
    } else if (valueChanged) {
      // L2: a first pass is born held — staged, committed with the
      // transaction, its effect's first run the landing's (A29; `effect()`
      // skips the synchronous first run on a staged value) — when the flush
      // has joined a transaction and either the pass read a held node (it
      // derives from that world — the join merged the node's transaction
      // into the flush's), or — a verdict lane's mount, mainline — read a
      // staging of this flush (the same world before the seam parks it; the
      // mount is not shown ahead of it: #3851), or a pass created it (ruling
      // A: a held pass's children are the transaction's). Any other mount
      // that read a staging does not join by being new (2026-10-07): it
      // publishes and re-derives if the flush parks. A node created outside any pass
      // that read only the committed world (root setup, a mount, an effect
      // callback) is nobody's frame and publishes directly, as does a first
      // pass that runs before anything joins: the pass's input, not a verdict
      // after it. An effect still carrying an uncommitted staged value
      // re-stages: the commit applies the latest pass, not the born-held one.
      if (lane !== null) {
        // Lane work: the lane's value — into the slot while the lane has not
        // revealed (its reveal shows it), as its staging once it has (the
        // next reveal promotes it; the screen keeps the revealed value). An
        // effect's value slot is private: the run the lane holds is what
        // shows it — unless the effect was born held, whose first run is the
        // commit's (A29): it re-stages, as below.
        if (isEffect && el._pendingValue === NOT_PENDING) el._value = value;
        else if (isEffect || lane._shown) el._pendingValue = value;
        else el._x!._lane = value;
      } else if (
        create
          ? !(
              (flushTransaction !== null || passTx !== null) &&
              (joined || (creatorPass(oldcontext)?._flags as number) & REACTIVE_JOINED)
            )
          : isEffect && el._pendingValue === NOT_PENDING
      ) {
        // A first pass publishes directly. So does an effect: its value slot
        // is private (only its own run reads it), and the staging round-trip
        // (queuePendingNode + commitPendingNodes) paid per effect on the
        // plain path is pure overhead.
        // NOTE (stage-3, 2026-08-21): a quiet-world MEMO direct-commit was
        // attempted here and REVERTED — memo staging is load-bearing beyond
        // transitions: mid-batch pulls (read-triggered recomputes before
        // sources commit) must see the fresh value while PLAIN reads stay
        // committed until flush (#3009 purity). The pending round-trip is
        // that separation; it cannot be skipped on any path a pull can reach.
        el._value = value;
      } else {
        el._pendingValue = value;
        // D-39: a staged recovery keeps the error it replaces the display
        // until it commits (`commitPendingNode`), as a write over one does
        // (`setMemo`).
        if (outgoingError) el._x!._shownError = outgoingError;
        // Born held: in the transaction from birth, so a read of it this
        // tick is a read of its world (the mount-during-a-hold case), not
        // only after the seam parks it.
        if (create) {
          holdNode(el, (flushTransaction ?? passTx)!);
          // Born into the future: no committed value until the landing
          // (`commitPendingNode` initializes it) — every reader of it
          // derives from the future (`read`), an untracked one throws
          // (A19 exc. 1).
          el._statusFlags |= STATUS_UNINITIALIZED;
          // A boundary that has not shown content catches it: its fallback
          // waits for the commit (#3540). (The pass's own status clear above
          // dropped what the read recorded.) Not when the flush has joined
          // the hold and the pass is its own (not a verdict lane's mount,
          // #3851): the mount is part of the hold, and the boundary appears
          // at its commit, its fallback never seen (D-13, U-3) — a `<Show>`
          // mounting it over a landing included.
          freshHook?.(el, !mount && flushTransaction);
        }
        if (__DEV__) devTrackHeldPending(el);
      }

      // insertSubs only walks _subs (no scheduling of its own), so a
      // subscriber-less node has nothing to notify.
      if (el._subs !== null) {
        insertSubs(el);
        // Lane work re-staged: the lane's members re-derive as its work.
        if (lane !== null) laneDirty(el, lane);
      }
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) insertIntoHeapHeight(s._sub, dirtyQueue);
    }

    // Silent recovery: errored → unchanged value fires no notification, but
    // dependents still holding the propagated error consumed their dirty flag
    // in an errored run and may sit on stale commits (#2949). Changed-value
    // recoveries ride insertSubs above; a comparator throw re-errored the node
    // (el._x?._error re-set), so this only runs on a genuinely clean recovery.
    if (!valueChanged && !el._x?._error) {
      if (outgoingError) settleErroredDependents(el, outgoingError);
      // Self-registration (this node's own superseded flight) is the #3181
      // sweep's business below — retiring it here too would walk twice.
      if (outgoingPendingSources)
        for (const source of outgoingPendingSources)
          if (source !== el) settlePendingSource(el, source);
    }

    // #3181: a synchronous settle supersedes the old landing callback, so
    // recompute owns its pending-source sweep. An uninitialized node without
    // a replacement source still has no truth to reveal and must stay parked.
    if (wasPendingSource && !(el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)))
      settlePendingSource(el);
  }
  // A first pass that went pending where the born-held arm would have held
  // its value (it read a held node, or a verdict lane's mount read a staging,
  // #3851) is held like it: its answer is the hold's, and the hold waits
  // for it (A29, #3800). A boundary that has not shown content catches it
  // and it is held all the same — its answer reveals no earlier than the
  // hold's commit (D-12) — but the hold does not wait for it: its only
  // readers are behind the fallback (`_hidden`; F-4, #3540). A boundary
  // re-armed by `on` owns what it collects outright (D-14): not held. Only
  // an effect is caught: a derivation left pending is no reader (Reader,
  // D-12) — held, so its answer is the hold's and a render effect reading
  // it joins, but it reaches no boundary, and the commit waits for it only
  // through such a reader (`blockedBy`, #4542).
  if (create && lane === null && joined && el._statusFlags & STATUS_PENDING) {
    const t = flushTransaction ?? passTx;
    if (t && !t._lane && (!isEffect || freshHook?.(el) !== CAUGHT_REARMED)) holdNode(el, t);
  }
  // Dependencies are the committed frame's until it is replaced (A30, #3410):
  // a pass that staged its value leaves the previous pass's tail linked for
  // `commitPendingNode` to trim, so a write to a dependency the committed
  // value still derives from reaches this node until the commit. A pass that
  // published directly, or changed nothing, trims now. An errored pass (a
  // throw, NotReady included, or a comparator throw above) keeps its full
  // list as before — `_depsTail` marks where it stopped — and the commit
  // skips it by the same `_error`. An effect's frame is the run its value is
  // applied by, not the value slot (#3438): a pass that still owes a run
  // (`_modified`) has not replaced what the last run published, so its tail
  // waits for `runEffect` to trim once the run applies. A pass that changed
  // nothing replaced nothing either (#3469): it cannot know at its tail
  // whether the flush that ran it will park with its inputs held, so the
  // trim waits on the flush's verdict (`heldTrim`: trimmed at the commit,
  // kept at a park — one spurious recompute at most). A creation pass and a
  // tracked effect trim now: their frames are replaceable like a direct
  // commit, and a tracked effect's spurious run would be user-visible.
  if (!el._x?._error && el._pendingValue === NOT_PENDING && !(isEffect && (el as any)._modified)) {
    if (create || isEffect === EFFECT_TRACKED) trimStaleDeps(el);
    else heldTrim(el);
  }
  // Observe: the posture the run executed under — lane work (optimistic:
  // overlay, never waste), a transaction's pass (held), or plain.
  if (__OBSERVE__ && attrHooks !== null)
    attrHooks.recomputeEnd(
      el,
      create,
      devChanged,
      lane !== null,
      flushTransaction !== null || passTx !== null || (el._config & CONFIG_HELD) !== 0,
      el._pendingValue !== NOT_PENDING
    );
  // A staged value, a parked frame (L2: the commit retires it), or status the
  // commit sweep must settle (a pending or uninitialized pass), queues the
  // node for this flush's commit. A first pass queues only when pending or
  // born held: otherwise its value published directly. A queued pass's
  // children are uncommitted (CONFIG_STAGED) until that commit.
  if (
    el._pendingValue !== NOT_PENDING ||
    (el._x !== null && (el._x._pendingFirstChild !== null || el._x._pendingDisposal !== null)) ||
    ((el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)) !== 0 &&
      (!create || (el._statusFlags & STATUS_PENDING) !== 0))
  ) {
    el._config |= CONFIG_STAGED;
    // Lane work is the lane's to reveal (its seam), not this flush's commit.
    if (lane === null) queuePendingNode(el);
  }
  if (laneStageHook) setPassLane(prevLane);
  // Missed-wake reschedule (see the finally above): values this pass read
  // before the nested commit are stale, so run again now that the heap will
  // accept the node. Equality gates stop same-value landings from cascading,
  // and a re-run only latches again if another nested commit changes a dep
  // beneath it — convergent unless deps genuinely keep changing.
  if (missedWake) {
    enqueueSub(el);
    schedule();
  }
}

function updateIfNecessary(el: Computed<unknown>): void {
  // Never re-enter a node that is currently computing: its dep bookkeeping
  // (_depsTail/_depGen) is live, and a nested recompute would corrupt it.
  // A mid-pass mark stays latched for recompute's own tail to reschedule
  // (#3037); readers meanwhile serve the values the pass has so far.
  // Never recompute a DISPOSED node either: recompute rewrites _flags and
  // would resurrect it (#2983) — readers serve its last value.
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

  // The guard above refused an already-disposed node; the recompute it just
  // ran may have disposed it (#3621) — carry the flag, or it comes back alive.
  // The manual-write mark is state, not scheduling (#3612, A34 rule B): it
  // says the node's staging is a PROPOSAL, lifted by a pass that re-derives
  // or by the commit — a pull that recomputed nothing must not. Nor may it
  // erase the last pass's verdicts for the landing (a stale reader's
  // REACTIVE_FRAME_READ — a verdict reader pulled by a sibling before the
  // landing lost its re-derivation; the lane reads likewise).
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
  // `in` (not `!== undefined`): an explicit `loadingValue: undefined` on a
  // `T | undefined` node is a real commit #0. The typeof guard tolerates
  // non-object option values that older call shapes force through `as any`.
  const loading = options !== null && typeof options === "object" && "loadingValue" in options;
  // Two literals, one per tier, selected at build time (the observe flag is
  // a literal after replacement; the untaken branch is dead code). The observe
  // literal is the prod literal plus its `_name` and `_loc` slots — slots in
  // the boilerplate, because a post-construction `self._name = …` forces a
  // hidden-class transition and an out-of-object property store on EVERY node
  // (measured: the whole of the observe tier's creation overhead). Keep the
  // two in sync — the dist artifact test pins observe's key set to prod's
  // plus the slots.
  const self: Computed<T> = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
          // Plumbing is an observe-tier notion (a name and records to
          // withhold); the prod literal never carries the bit.
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
        // The slot is always present (hidden class); plumbing leaves it
        // unset, which `ownerPath` skips.
        _name: options?._plumbing ? undefined : (options?.name ?? "computed"),
        _loc: options?.loc,
        // Observe: the verdict windows this pass entered (verdict.ts) — a
        // slot, so the stamp is never a write after construction.
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
        // A loadingValue node is born committed: commit #0 is already in _value.
        _statusFlags: loading ? 0 : STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _notifiedAt: -1,
        _loading: loading,
        // Cold machinery (async slots) lives one hop away in the lazily-allocated extension — the core literal MUST
        // stay under V8's in-object boundary (§12: past ~39 fields every
        // allocation spills to a backing store and creation cost ~4x's).
        _x: null
      } as Computed<T>);
  if (options?.unobserved) (ext(self) as NodeExtension)._unobserved = options.unobserved;
  // Dev only, as `_wide` (see CONFIG_SUPERSEDES).
  if (__DEV__ && options?._supersedes) self._config |= CONFIG_SUPERSEDES;
  setupComputedNode(self, options);
  return self;
}

/** Lazily allocate a node's cold extension (ONE shape for signals and
 * computeds — `_x` access stays monomorphic). Installers write through
 * this; hot paths read `el._x?._field` gated by the _config presence bits.
 * Never call ext() just to store a field's default. */
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
    _lane: NOT_PENDING,
    _marks: 0,
    _shownError: null
  });
}

/** A tracked read of a held node (the reader derives from its transaction's
 * world): the reading pass is marked as having read it (born-held decision
 * in `recompute`), and the flush joins the node's transaction — unless the
 * reader is a render effect. A render effect is the frame, not a derivation
 * (rule 3): in that transaction's own flush, or born into it (uninitialized,
 * A29), it reads the staged value and holds nothing of its own; otherwise it
 * reads the committed value instead (`frameRead`). A node born into the
 * future has no committed value: every reader joins it. A first pass is
 * something not ready under a loading boundary that has not shown content:
 * the boundary collects it and shows its fallback, and the pass is the
 * boundary's, not the tick's (A29's boundary exemption, #3540). */
export function joinPass(c: Computed<any>, el: Signal<any> | Computed<any>): void {
  c._flags |= REACTIVE_JOINED;
  if (__TEST__) shadowExternalRaise(c, RAISE_H);
  // A new memo's first pass is the hold's work (born held) but not the
  // tick's: a render effect that reads it decides — under a boundary that
  // catches it, the boundary's; otherwise the tick joins the hold (#3540:
  // the reader's position, not where the memo was created). Its catch, if
  // any, is at its staging.
  if (
    (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED ||
    (c as any)._type !== EFFECT_RENDER
  )
    joinPassTx(
      txOf(el),
      (!(c as any)._type && c._statusFlags & STATUS_UNINITIALIZED) || freshHook?.(c)
    );
}

/** `joinPass` into the hold `t` (a folded guess's: store/optimistic.ts
 * `foldedRead`, D-34) — a reader is never a render effect there. */
export function joinPassAt(c: Computed<any>, t: Transaction): void {
  c._flags |= REACTIVE_JOINED;
  if (__TEST__) shadowExternalRaise(c, RAISE_H);
  joinPassTx(t, (!(c as any)._type && c._statusFlags & STATUS_UNINITIALIZED) || freshHook?.(c));
}

/** A15's stale reader (shared-hole and reveal corollaries): a render effect
 * reading a node held by a transaction that is not the flush's. It is served
 * the committed value — a pending one's too — publishes mainline, and is
 * re-derived after that transaction's landing (`_reruns`,
 * REACTIVE_FRAME_READ) so the frame catches up with it once it is the
 * committed world. Not a frame born into that transaction (held and never
 * committed — created by one of its held passes, A29; `bornInto`): that
 * one reads its transaction's values and keeps staging. Not of a flight
 * whose inputs are already visible (CONFIG_INPUTS_PUBLISHED, #3305): its
 * committed value would tear against them, so the reveal observes the
 * flight instead. Once per pass.
 *
 * Lane work is a stale reader too (maintainer, 2026-10-01: a lane sees the
 * screen plus its own guesses). A held write is held because showing it
 * would tear against the rest of its frame; a lane revealing a derivation
 * of it would show it anyway, beside inputs still committed elsewhere on
 * the page. The guess is the one value the user opted into predicting. So
 * a lane pass reading a transaction's held node — its parent's or any
 * other's — derives from the committed value and is re-derived at that
 * landing. The case read-through was built for — a corrected guess whose
 * downstream async must refetch with the truth at once, while another of
 * the parent's flights is still up — needs none of this: the correction
 * dissolves the lane, and the refetching pass is the parent's own, reading
 * the truth as a member (`joinPass`). */
function frameRead(c: Computed<any>, el: Signal<any> | Computed<any>): boolean {
  // Frame readers: a render effect, a verdict reader (CONFIG_VERDICT — it
  // reads the screen like one: `[isPending(x), x()]` never pairs the fresh
  // value with pending, A10, because the reader never sees the fresh value),
  // and lane work (a lane sees the screen plus its own guesses). Not a
  // mount's memo (2026-10-02, considered and reverted): a memo is not a
  // leaf — the transaction's own later passes read it — so a mainline mount's
  // derivations carry the future (A29, born held); only its direct bindings
  // read the screen. Lane work with no committed value yet reads a flight
  // as a mount's memo does: it enters, and the boundary it mounts catches
  // the pending (#3540).
  // A boundary's tree and output (CONFIG_FRAME) read as a render effect
  // does: structure, not a derivation of what it shows (#4283). A mount
  // under a hold still enters it: the content memo it reads is born held,
  // with no committed value to serve.
  // (Verdict readers and lanes exist only with their engines installed.)
  const verdict = observeFlightHook && c._config & CONFIG_VERDICT;
  const lane = laneStageHook && passLane !== null;
  if (
    (!lane ||
      (c._statusFlags & STATUS_UNINITIALIZED &&
        (el as Computed<any>)._statusFlags & STATUS_PENDING)) &&
    !verdict &&
    // CONFIG_FRAME, spelled as at the effect's creation.
    (!(c._config & (EFFECT_RENDER << 23)) || el._config & CONFIG_INPUTS_PUBLISHED)
  )
    return false;
  const t = txOf(el);
  // Lane work and verdict readers are never the transaction's pass, whichever
  // flush runs it: a node T holds re-enters T when it re-runs (`recompute`'s
  // head), and the pass may then read a guess and become the lane's.
  if ((t === flushTransaction && !lane && !verdict) || bornInto(c, t)) return false;
  staleReader(c, t);
  // Lane work or a verdict reader no longer waits on `el`'s flight (lanes.ts
  // `laneServed`, A15).
  if (lane || verdict) laneServedHook!(c, el);
  return true;
}

/** A node born into transaction `t`: held by it and never committed (A29,
 * ruling A) — uninitialized (born held), or a member of the frame one of its
 * held passes built (CONFIG_HELD_FRAME). Its branch exists only in `t`: it
 * has no screen to read, so it reads `t`'s values, whichever flush runs it,
 * and keeps staging (#4010). */
export function bornInto(c: Computed<any>, t: Transaction): unknown {
  return (
    (c._statusFlags & STATUS_UNINITIALIZED || c._config & CONFIG_HELD_FRAME) &&
    c._config & CONFIG_HELD &&
    txOf(c) === t
  );
}

/** The computed whose pass a creation under `owner` belongs to (a root's is
 * its nearest computed ancestor's), or null outside every pass. */
export function creatorPass(owner: Owner | null): Computed<any> | null {
  return owner !== null && (owner as Root)._root
    ? (owner as Root)._parentComputed
    : (owner as Computed<any> | null);
}

/** What `born` and the passes still running around `p` read — its
 * creator's, theirs — of the future or a staging (REACTIVE_JOINED |
 * REACTIVE_STAGED_READ): a pass created by one that did has no screen; its
 * branch exists only in that world (#4341). */
export function creatorReads(p: Computed<any> | null, born: number): number {
  return (p = creatorPass(p!._parent))?._flags! & REACTIVE_RECOMPUTING_DEPS
    ? creatorReads(p, born | p!._flags)
    : born & (REACTIVE_JOINED | REACTIVE_STAGED_READ);
}

/** L2 — park the previous pass's frame for this node's commit: the children
 * (already allocated — nothing new) and the `_disposal` list move to the
 * extension, keep reacting from the heap, and die when the commit publishes
 * the frame that replaces them (`commitPendingNode`) or when the owner does. */
function parkChildren(el: Computed<unknown>): void {
  markDisposal(el);
  const x = ext(el);
  x._pendingDisposal = el._disposal;
  x._pendingFirstChild = el._firstChild;
  el._disposal = null;
  el._firstChild = null;
  el._childCount = 0;
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
  options: NodeOptions<T> | undefined
): any {
  const transparent = options?.transparent ?? false;
  // Prod and observe boilerplates — see computed() for why the observe tier
  // gets its `_name` as a literal slot rather than a write after the fact.
  // The default label is the node kind (tracked effects relabel their computed
  // in trackedEffect); the wrappers in signals.ts no longer spread a name into
  // the options to get it.
  const self = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, context),
        _config:
          // CONFIG_FRAME for a render effect (EFFECT_RENDER = 1; a user
          // effect's 1 << 24 is unused).
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
          // CONFIG_FRAME for a render effect (EFFECT_RENDER = 1; a user
          // effect's 1 << 24 is unused).
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
  // Effects dispatch status through the SHARED notifier (statusNotifierOf,
  // keyed off _type) — storing it per node forced a full NodeExtension
  // allocation on EVERY effect at creation (an alloc + 19 field stores,
  // +23% effect creation, caught by the creation benches). Only genuinely
  // per-node channels (boundaries) live on _x.
  if (options?.unobserved) ext(self)._unobserved = options.unobserved;
  // Dev only: the observe artifact mangles `_` option names, so no other
  // tier could be handed the option (see CONFIG_WIDE).
  if (__DEV__ && options?._wide) self._config |= CONFIG_WIDE;
  setupComputedNode(self, lazyOptions);
  return self;
}

/**
 * The shared status notifier for effect nodes, installed once by effect.ts
 * at module evaluation (`this`-dispatched — one function serves every
 * effect, so nodes never store it). CARVE 4: the boundaries' per-node
 * channel (`_x._notifyStatus`) went with them; effects are the only
 * display consumers.
 */
export let effectStatusNotify: ((this: any) => void) | null = null;
export function setEffectStatusNotify(fn: NonNullable<typeof effectStatusNotify>): void {
  effectStatusNotify = fn;
}

/** Resolve a node's status notifier: effect nodes (`_type` — EFFECT_PURE is
 * 0, and only effect literals carry the field) get the shared notifier.
 * Presence doubles as the "display consumer" membership test in the status
 * walks, exactly as the per-node field did when every effect carried one. */
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
  // Prod and observe boilerplates — see computed(). The observe literal adds
  // `_name`, `_loc` and `_owner` (the creating owner, stamped by registerGraph for
  // createSignal nodes so ownerPath can locate signal subjects; null here,
  // and staying null on internal signals — one shape either way).
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
        // Signal-literal diet (§12e): NO _time/_fn/_statusFlags slots. Stores
        // materialize one signal per touched leaf, so signal bytes are store
        // bytes. _time is write-only on signals (every read site is computed-
        // typed error-retry gating); _fn/_statusFlags read falsy-identically as
        // missing properties on the shared paths (undefined masks to 0).
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

/** A store slot node (CONFIG_SLOT_NODE): the whole node in ONE literal — the
 * target and key as back-refs in place of closures (`equals` is a method
 * call, `this` the node; the unobserved sweep dispatches to one shared hook,
 * graph.ts), the store's wrap cache (`px`/`pxv`: the proxy last served for
 * this key and the raw it wrapped — one pointer compare replaces a WeakMap
 * lookup per read) and the accessor verdict (`acc`) pre-shaped. No options
 * object, no NodeExtension, no post-construction expandos. `ownedWrite` is
 * baked in: the setter carries the owned-scope guard; node-level writes are
 * the store's notification machinery. The observe literal adds the label
 * and location slots (the store relabels `store.<key>` and stamps the
 * store's `loc` when the engine is installed). */
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

/**
 * When set to a component name string, any reactive read that is not inside a nested tracking
 * scope will log a dev-mode warning. Managed automatically by `untrack(fn, strictReadLabel)`.
 */
/** The verdict windows' read (verdict.ts), installed while a `latest` or
 * `isPending` window is open and null otherwise: `read` dispatches to it
 * then, and a program that never imports them never has one. */
export let verdict: ((el: Signal<any> | Computed<any>, c: Computed<any> | null) => unknown) | null =
  null;
export function setVerdict(fn: typeof verdict): void {
  verdict = fn;
}
export let strictRead: string | false = false;
/** Dev-only: explicit untrack() nesting, so deliberate post-await reads stay quiet. */
export let untrackDepth = 0;
/**
 * Dev-only: > 0 while Solid runs user code that is imperative by construction
 * — an effect callback (effect.ts) or an action body's synchronous slice
 * (action.ts). Both run with no owner, exactly like an async continuation, so
 * the post-await read check (dev.ts) consults this rather than blame the
 * continuation that called flush() or invoked the action. Both sites bracket
 * with try/finally, so a throw cannot leave it raised.
 */
export let callbackDepth = 0;
export function enterCallback(): void {
  callbackDepth++;
}
export function exitCallback(): void {
  callbackDepth--;
}
/**
 * Dev-only: > 0 while owner teardown runs cleanups (`_disposal` entries and
 * effect-returned cleanups — owner.ts), for the same reason. The owned-scope
 * write guard (setSignal, markRefresh, the store setter) stands down here
 * too: a cleanup is teardown, not part of whichever computation is disposing
 * its owner (a list pass removing a row, a branch switching away), so its
 * writes are imperative like an effect callback's (#4165). Kept apart from
 * `callbackDepth` because its sites cannot use try/finally (the frame would
 * survive into prod). A throwing cleanup is caught (owner.ts `runCleanup`);
 * anything else escaping a teardown leaves it raised, and dev.ts resets it on
 * the next microtask, which teardown — synchronous — never spans.
 */
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
/**
 * Dev-only: the DOM event being dispatched when the open strict-read window
 * opened (`globalThis.event`; null between dispatches and off the main
 * thread's Window), or `ANY_EVENT` when the window did not record one. A DOM
 * call made in an effect callback that dispatches events synchronously
 * (`el.focus()`, `el.click()`, `dialog.showModal()`) runs that event's
 * handlers inside the window; a handler is a one-shot snapshot whoever
 * dispatched the event, so a read made while a different event is current is
 * outside the window (#4235). Only queued effect runs record the event, read
 * once per queue (the getter is costly under jsdom); `strictReadActive` is
 * the check.
 */
export let strictReadEvent: unknown;
// `?? null`: no current event must not read as a missing argument below.
export const dispatchingEvent = (): unknown => (globalThis as any).event ?? null;
export function setStrictRead(v: string | false, event: unknown = ANY_EVENT): string | false {
  const prev = strictRead;
  strictRead = v;
  strictReadEvent = event;
  return prev;
}
/** Dev-only: is the strict-read window open for a read made now? */
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
  tracking = false;
  if (__DEV__) {
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
      untrackDepth--;
    }
  }
}

/**
 * Set while runtime bookkeeping reads a node inside another node's pass (a
 * loading boundary priming its tree at creation, from whatever pass is
 * mounting it). `context` is that node, but the read is nobody's: the value
 * is probed, never derived from, so nothing the read would normally record
 * on `context` may be recorded — not the untracked-pending re-run link
 * (`read`, `!tracking`; #3528: a boundary's `on` key read this way from
 * `notify` linked the key's source into an unrelated async memo, a cycle that
 * never converged), and not a transaction entry (`enterStagedRead`; #3540: a
 * born-held tree would otherwise pull the mounting pass into the hold).
 */
export let spectating = false;

/**
 * Evaluates `fn` untracked, recording nothing on the current `context`: no
 * untracked-pending re-run link, no transaction entry. For bookkeeping reads
 * made on behalf of no node — see `spectating`.
 */
export function spectate<T>(fn: () => T): T {
  const prev = spectating;
  spectating = true;
  try {
    return untrack(fn);
  } finally {
    spectating = prev;
  }
}

/**
 * Bring a computed to a readable state: lazy/disposed nodes are (re)computed;
 * `refresh` additionally pulls the node fully up to date so its status flags
 * reflect the current graph.
 */
export function prepareComputed(comp: Computed<unknown>, refresh: boolean): void {
  if (comp._flags & REACTIVE_LAZY) {
    comp._flags &= ~REACTIVE_LAZY;
    recompute(comp as Computed<any>, true);
  } else if (comp._flags & REACTIVE_DISPOSED) {
    // Two disposal lifecycles share the flag (#3024). Observation-lifecycle
    // nodes (CONFIG_AUTO_DISPOSE) are dormant — torn down by unobserved()
    // when the last subscriber left — and reads reawaken them; that is the
    // pay-for-use contract. Owner-lifecycle nodes are dead: recomputing would
    // re-run user code in a torn-down tree (and discard manual writes on
    // derived-writable signals), so reads return the last committed value.
    if (comp._config & CONFIG_AUTO_DISPOSE) {
      const parent = comp._parent as Computed<unknown> | null;
      if (parent !== null) {
        // A dormant node was off the chain when its owner died, so the strip
        // in disposeChildren missed it: freeze here instead (#3024).
        if (parent._flags & REACTIVE_DISPOSED) {
          comp._config &= ~CONFIG_AUTO_DISPOSE;
          return;
        }
        // A zombie never left its chain (the parked frame is drained whole,
        // and its members skip the splice): relinking would put it on the
        // live chain too.
        if (!(comp._flags & REACTIVE_ZOMBIE)) linkChild(parent, comp);
      }
      recompute(comp as Computed<any>, true);
    }
  } else if (refresh) {
    updateIfNecessary(comp);
  }
}

// CARVE 3: until()'s authoritative-view wakeup (notifyAuthoritativeObservers /
// installAuthoritativeRead), the stale-of-foreign clause (heldFromStale,
// recordStaleReplay, ownsHold) and the transaction entry on a staged read
// (enterStagedRead, stagedEntry / born held, underFreshLoadingBoundary) went
// with the transactions.

/**
 * Rule 1 (value selection): does this reader see a STAGED node's COMMITTED
 * value? One implementation of the rule the fast paths (read's fast block)
 * carry as their trivial ternary. In order:
 * - no reader at all (an untracked read) — the committed frame;
 * - nothing staged;
 * - a children-forbidden reader (createTrackedEffect / onSettled: the frame,
 *   never the graph — A32).
 * False means the reader derives from the staged value.
 */
export function readerSeesCommitted(
  el: Signal<any> | Computed<any>,
  c: Computed<any> | null
): boolean {
  return (!c ||
    el._pendingValue === NOT_PENDING ||
    c._config & CONFIG_CHILDREN_FORBIDDEN) as boolean;
}

/** A28 — set when a node is staged (queuePendingNode) OUTSIDE a flush;
 * cleared when the next flush begins. The read sites test this one module
 * boolean instead of `globalQueue._running`: inside a flush it is false and
 * the A28 arm costs nothing; outside, only a tick with unflushed writes pays
 * the staged-node check. */
export let unflushedStaged = false;
export function markUnflushedStaged(): void {
  unflushedStaged = true;
}

/** A28 — a write becomes visible at flush. Outside a flush, a node holding a
 * staged value was written since the last flush: staging commits at flush
 * end, so nothing else leaves a node in this state. Inside a flush the rule
 * does not apply (A28 (4): promoted within the round). The value an
 * unflushed node serves is its committed value, or NOT_PENDING when nothing
 * is unflushed. Exempt: promoted writes (A28 (4): a write issued inside a
 * recompute is promoted at that recompute's end — boundary and loading
 * machinery, signals declared for in-computation writes). */
export function unflushedValue(el: Signal<any> | Computed<any>): unknown {
  if (globalQueue._running || el._pendingValue === NOT_PENDING || el._config & CONFIG_PROMOTED)
    return NOT_PENDING;
  // A held node (L2) carries a staged value between flushes too, but it was
  // flushed — and parked. Not an unflushed write — unless rewritten since:
  // then the flushed staging is what the world sees until the next flush.
  if (el._config & CONFIG_HELD) return el._x!._flushedAt === clock ? el._x!._flushed : NOT_PENDING;
  return el._value;
}
/** A28: a held node rewritten outside a flush keeps the staging the last
 * flush left (`_flushed`) until the flush that carries the rewrite — the
 * stash is stamped with the clock, which that flush advances. */
export function stashFlushed(el: Signal<any> | Computed<any>): void {
  const x = el._x!;
  if (x._flushedAt !== clock) {
    x._flushed = el._pendingValue;
    x._flushedAt = clock;
    unflushedStaged = true;
  }
}
/** Nodes written inside a creation-time recompute (CONFIG_PROMOTED). */
const promotedWrites: Array<Signal<any> | Computed<any>> = [];
/** A derivation served the committed value because of an unflushed write
 * (A28) must run again in the flush that carries it — the late-linker case
 * (#3337's reason to defer the walk): it linked after the write walked. */
export function markLateLinker(c: Computed<any>): true {
  // The pass's own tail re-enqueues on this latch (recompute's finally) —
  // a direct enqueue here would be wiped by the pass's flag reset.
  c._flags |= REACTIVE_MISSED_WAKE;
  return true;
}

export function resyncUnflushedCompanions(): void {
  unflushedStaged = false;
  // Length-guarded: the common flush has nothing here and allocates nothing.
  if (promotedWrites.length !== 0) {
    for (const el of promotedWrites) el._config &= ~CONFIG_PROMOTED;
    promotedWrites.length = 0;
  }
}

/** A tracked read's pull of a computed: bring it current when the flush has
 * reached its height (or the reader is a fresh-pull waiter), and sit the
 * reader above it. */
export function pullComputed(owner: Computed<any>, c: Computed<any>): void {
  if (owner._height >= dirtyQueue._min) {
    markNode(c);
    markHeap(dirtyQueue);
    updateIfNecessary(owner);
  }
  // Fresh-pull readers (awaitable refresh's waiter) recompute a dirty
  // source inline even when the height gate defers to the flush: the
  // waiter must park on the re-ask's window (or serve its sync answer),
  // never read the PRE-re-ask value as settled. Self-guarded: a clean
  // node no-ops and updateIfNecessary refuses disposed nodes (#2983) —
  // a dead target serves its last value, which is already quiescent.
  else if (c._config & CONFIG_FRESH_READ) updateIfNecessary(owner);
  const height = owner._height;
  // parent check is shallow, might need to be recursive
  if (height >= c._height && owner._parent !== c) c._height = height + 1;
}

/**
 * Dev only: a read's diagnostics — the devtools read hook, the foreign-read
 * check and the post-await untracked-read check. Every caller guards with
 * `__DEV__`: `read` here, and a store leaf's read that is served without
 * `read` (`nodeValue`'s first landing), so no read goes unseen in dev.
 */
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

/**
 * D-22 (amended 2026-10-30), F-9: `el`'s first value was staged this flush
 * and `el` (`owner`) went pending on a re-ask in it — an async first answer
 * landing in the tick a write re-asks it: answered, then re-asked. A memo
 * `c` with no value — waiting on `el` (on the source a read of `el` parks
 * on: `el` itself, or the async it derives from — at any depth), or not
 * waiting at all (its wait released by the landing, or a first pass) —
 * derives from that value, as a flush of the answer alone would have let it
 * (whether the landing ran before the re-ask reached `c` is the flush's
 * order, not the reader's: D-22, at any depth), then runs
 * again (the missed-wake latch) and waits on the re-ask holding it:
 * `latest`/`isPending` of it read as of `el`. One pass: every read of it is
 * served (the latch marks it); its wait on `el` is dropped, so the re-run
 * throws and waits on `el` afresh. One served pass a flush (`_served`): a
 * pass that throws anyway, on a read beside it, parks on `el` again, and its
 * re-run is not served — served, it would re-run without end. Not a reader
 * waiting on another source, a render effect (the frame: its plain read
 * throws), lane work
 * or a verdict lane's pass (D-37: the screen plus the lane's own guesses),
 * or a held node (the staging is the hold's). A plain read of such a memo
 * throws as one of a memo with no value; only `latest`/`isPending` tell them
 * apart, so it is the verdict engine's (`read` calls it behind
 * `observeFlightHook`, on the path where a pending read throws).
 */
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

export function read<T>(el: Signal<T> | Computed<T>): T {
  // Shadow (S0): every read is run through `shadowRead`, which re-enters
  // here once (the bypass) and compares the slot the table predicts with
  // the one the deciders below chose.
  if (__TEST__ && !shadowConsumeBypass()) return shadowRead(el);
  if (__DEV__) devRead(el);

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  const computed = el as Partial<Computed<unknown>>;
  // CARVE 1: `owner` was `el._firewall || el` — a store leaf's status,
  // height and error were read off its projection computed. (Typed loosely
  // as the `||` expression was: a signal's `_statusFlags`/`_height` read as
  // undefined and mask to 0 on every site below.)
  const owner = el as Computed<any>;

  // The verdict windows (`latest`, `isPending`; verdict.ts): one cold path,
  // off this one, present only while a window is open. It wakes a lazy or
  // dormant memo itself, outside the window (#4366).
  if (verdict !== null) {
    // D-42 (dev): the window's throws (an uninitialized node, an errored
    // derivation, a staged error — verdict.ts) are this read's throws.
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

  if (typeof computed._fn === "function") prepareComputed(el as Computed<unknown>, false);

  if (
    !computed._fn &&
    el._x?._snapshotValue === undefined &&
    !snapshotCaptureActive &&
    (!unflushedStaged || el._pendingValue === NOT_PENDING) && // A28, see readNodeFast
    !(el._config & CONFIG_OVERRIDE) && // lanes: the slow path's one arm
    (!__DEV__ || !strictRead)
  ) {
    if (__TEST__) shadowExpect(c as Computed<any> | null, el, tracking, 0, spectating, false);
    if (c) {
      if (tracking) link(el, c as Computed<any>);
      // L2: a pass that reads something already in the future joins it —
      // the one mechanism behind "a write that reaches the future joins
      // it". Tracked or not (`untrack` is about dependencies, not about
      // which world a pass derives from — posture-store-parity S4/S5): a
      // derivation of a held write published mainline would tear. Frame
      // readers (children-forbidden, A32) see committed below and stay
      // out; a render effect outside a parking flush sees committed and
      // stays out too (rule 3, `frameRead`). The pass remembers it read the
      // future (REACTIVE_JOINED): a first pass that did is born held (A29),
      // wherever it was created. Lane work sees the screen (`frameRead`).
      if (el._config & CONFIG_HELD && !(c._config & CONFIG_CHILDREN_FORBIDDEN)) {
        if (frameRead(c as Computed<any>, el)) {
          if (__TEST__) shadowActual(SLOT_C);
          return el._value as T;
        }
        joinPass(c as Computed<any>, el);
      }
    }
    // Committed visibility for untracked and children-forbidden readers.
    if (!c || el._pendingValue === NOT_PENDING || c._config & CONFIG_CHILDREN_FORBIDDEN) {
      if (__TEST__) shadowActual(SLOT_C);
      return el._value as T;
    }
    // A staging equal to the committed value is writes that netted (D-8): no
    // proposal, so not a read of the frame's future — nor, for a verdict
    // reader, a stale read of the tick's hold re-run at its landing (#4485).
    // (A plain signal is never uninitialized — the carve-out is `serve`'s.)
    // `===` alone identifies opposite signed zeros. Require SameValue too;
    // keep the strict check so an accepted NaN rewrite remains a proposal.
    const netted = el._pendingValue === el._value && Object.is(el._pendingValue, el._value);
    // Lane work over a folded lane (D-34), once the frame has a transaction,
    // reads the screen too.
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

  if (__DEV__ && strictRead && owner._statusFlags & STATUS_PENDING && strictReadActive())
    throwPendingUntrackedRead(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });

  // Rule 3: this read serves the committed value to a render effect outside a
  // parking flush (decided after the pull below — a pull can join).
  let committed = false;
  if (c) {
    if (tracking) {
      link(el, c as Computed<any>);
      if ((owner as Computed<unknown>)._fn) {
        pullComputed(owner, c as Computed<any>);
        // F-6 (#4050): a memo over a verdict reader's value derives from a
        // display-ahead read — a verdict reader from this pass's end, as if
        // it probed inline: it reads held values as the screen and shows the
        // verdict now. Not an effect: a render effect is a frame reader
        // already, and a user effect's posture is its own reads'.
        // A read of a pending node hands on no posture to a pass that is
        // the hold's own work and not a verdict reader already (#4504):
        // such a read throws — it read no value, and a node whose flight is
        // up is the hold's work, not a verdict reader (D-25, #3884). The
        // hold's own work is a pass born in its world (uninitialized, D-27)
        // or one over a pass of its own still staged for the commit.
        // Stamped, its next run — the hold's re-run at the landing of a
        // memo whose plain mount read held its reader (D-2, D-27) — was
        // served the screen beside the answer its reader waited for (F-2,
        // D-22). A memo with a committed value and none staged is no hold's
        // work, and its posture lasts until a pass completes having read no
        // verdict reader (D-25, ruled 2026-10-28) — a pass that threw on a
        // pending read did not complete. Unstamped, `latest(m2)` over a
        // verdict memo showed its re-run's staging ahead of the lane that
        // staging lands with (#4408). A
        // verdict reader keeps the posture it is served the screen with
        // (`observeFlight`). (A verdict memo exists only with the verdict
        // engine installed.)
        if (observeFlightHook && !(c as any)._type)
          (c as Computed<any>)._flags |=
            owner._config &
            CONFIG_VERDICT &
            (owner._statusFlags & STATUS_PENDING &&
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
          !(owner._statusFlags & STATUS_ERROR)
      );
    // L2, as in the fast block above (tracked or not). A node born into the
    // future (uninitialized) has no committed value: every reader derives
    // from the future there, a render effect included (A29: a stale reader
    // of it cannot fall back to the committed frame and enters instead).
    if (
      el._config & CONFIG_HELD &&
      !(el._config & CONFIG_OVERRIDE) &&
      !(c._config & CONFIG_CHILDREN_FORBIDDEN)
    ) {
      if (owner._statusFlags & STATUS_UNINITIALIZED || !frameRead(c as Computed<any>, el))
        joinPass(c as Computed<any>, el);
      else committed = true;
    }
  } else if (__TEST__) shadowExpect(null, el, tracking, 0, spectating, false);
  // Lanes: a lane's node (after the pull — the node is current). NOT_PENDING
  // falls through: lane work's read of a pending member throws like any.
  // (CONFIG_OVERRIDE is the lane engine's: no engine, no lane's node.)
  if (laneReadHook && el._config & CONFIG_OVERRIDE) {
    const v = laneReadHook(c as Computed<any> | null, el);
    if (v !== NOT_PENDING) return v as T;
  }

  // Ahead of the snapshot serve below: a component body's direct read is
  // wrong in the same way whether the pass is hydrating or not, and the
  // hydration pass is the console nobody is watching (#3675).
  if (__DEV__ && strictRead && strictReadActive())
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });

  // A reader in a snapshot scope (a hydration claim) is served the value the
  // server rendered with: a client write's recompute still in flight does
  // not pull the claim off the markup it adopts — the reader replays at the
  // scope's release. An errored node throws below as for any reader.
  if (snapshotCaptureActive && c && (c as Computed<any>)._config & CONFIG_IN_SNAPSHOT_SCOPE) {
    const sv = el._x?._snapshotValue;
    if (sv !== undefined && !(owner._statusFlags & STATUS_ERROR)) {
      const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
      const current = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (current !== snapshot) (c as Computed<any>)._flags |= REACTIVE_SNAPSHOT_STALE;
      if (__TEST__) shadowActual(SLOT_SNAPSHOT);
      return snapshot as T;
    }
  }

  // A stale reader of a held flight (rule 3, A15's reveal corollary) is served
  // the committed value — coherent with the frame, whose inputs are the
  // committed ones too — and does not go pending on it. So is lane work
  // reading a flight that is not the lane's own (the parent's, or
  // mainline's): a lane breaks out of its parent's hold and waits only on
  // what derives from the guess (A31: "under a lane, a pending node on no
  // lane serves its committed value").
  // A verdict reader likewise (CONFIG_VERDICT): a frame reader sees the
  // screen, and for a flight the screen is the committed value — a render
  // effect keeps its DOM by throwing, a memo has no DOM and is handed the
  // value. `[isPending(x), x()]` reads `[true, stale]` in either order (A10)
  // — unless the flight committed beneath inputs already on screen
  // (`observeFlight`), or the reader was born into the flight's transaction
  // (#4010): it has no screen, and waits on the flight with its frame.
  // (A lane, and a verdict reader, exist only with their engines installed —
  // the verdict engine imports the lane engine: without it the test folds.)
  if (
    laneStageHook &&
    owner._statusFlags & STATUS_PENDING &&
    !committed &&
    !(el._config & CONFIG_OVERRIDE) &&
    !(owner._statusFlags & STATUS_UNINITIALIZED)
  ) {
    // A reader with no committed value yet sees the flight pending: a
    // boundary a lane mounts shows its fallback (A29's boundary exemption).
    if (passLane !== null && !((c as Computed<any> | null)?._statusFlags! & STATUS_UNINITIALIZED))
      committed = true;
    else if (c !== null && c._config & CONFIG_VERDICT)
      committed = observeFlightHook!(c as Computed<any>, owner);
  }
  if (owner._statusFlags & STATUS_PENDING && !committed) {
    // A reader landing on a pending node throws; an untracked read of an
    // UNINITIALIZED node has no committed value to serve and throws too. A
    // children-forbidden reader (createTrackedEffect / onSettled) sees the
    // frame, not the graph (A32): the committed value, and the NotReady only
    // where there is none (uninitialized).
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
              nodeName: (owner as any)?._name
            },
            c
          )
        );
      }
      if (!(c._config & CONFIG_CHILDREN_FORBIDDEN) || owner._statusFlags & STATUS_UNINITIALIZED) {
        // D-22 (amended 2026-10-30), F-9: an answered-then-reasked first
        // answer (`servesStaged`), the verdict engine's — out of line, so
        // `read` gains a call only where a pending read would throw.
        if (observeFlightHook && servesStaged(c as Computed<any>, el, owner)) {
          if (__TEST__) shadowActual(SLOT_P);
          return el._pendingValue as T;
        }
        // An untracked read of a pending node still re-runs its reader when
        // the node settles — unless nobody is reading (`spectating`, #3528)
        // or the reader is the node itself.
        if (!tracking && !spectating && el !== c) link(el, c as Computed<any>);
        if (__DEV__) noteThrownRead(el, owner._x?._error);
        throw owner._x?._error;
      }
    } else if (owner._statusFlags & STATUS_UNINITIALIZED) {
      // (No reader pass: nothing to record against.)
      throw owner._x?._error;
    }
  }
  // An errored derive throws for every late reader instead of silently
  // serving node values (memo parity, #2897 ruling).
  if ((owner as Computed<any>)._fn && (owner as Computed<any>)._statusFlags & STATUS_ERROR) {
    // Only a genuine reactive re-read may retry an errored async source:
    // - tracking: owned/tracked scope only (never events / `untrack` / effect side-effect phase)
    // - owner._time < clock: only on a later cycle than the one the error was found
    if (tracking && (owner as Computed<any>)._time < clock) {
      recompute(owner as Computed<unknown>);
      if (__TEST__) shadowActual(SLOT_E);
      return read(el);
    }
    // D-41: a staged error replacing the shown one is this flush's answer
    // (`stageError`): a reader served the staging (`serve`) throws it, as it
    // would read a staged value, and stages its own error with it; one
    // served the screen throws the shown error. Thrown the shown error, a
    // reader born this flush published it, and its readers' stale error
    // committed after the new one (#4404).
    if (!committed && el._config & CONFIG_STAGED_ERROR) serve(el, c as Computed<any> | null);
    if (__DEV__) noteThrownRead(el, (owner as Computed<any>)._x?._error);
    throw (owner as Computed<any>)._x?._error;
  }

  // D-41: an untracked read reads the screen, and so does a frame reader
  // served the committed value — `serve` hands it that value as it does an
  // untracked read — a shown error included (`throwShown`).
  if (committed || !c) throwShown(el);
  const value = serve(el, committed ? null : (c as Computed<any> | null)) as T;
  if (
    !c &&
    typeof computed._fn === "function" &&
    el._config & CONFIG_AUTO_DISPOSE &&
    !(owner._statusFlags & STATUS_PENDING) &&
    !el._subs
  ) {
    // Deferred, not inline (#3078): an inline unobserved() here made untracked
    // reads destructive — dispose on this read, full revival recompute on the
    // next — so consecutive reads could answer differently with no write in
    // between.
    // The sweep at flush finalization re-validates and reclaims; schedule()
    // guarantees that flush happens even if nothing else is queued.
    dormantNodes.add(el as Computed<unknown>);
    schedule();
  }
  return value;
}

/** D-41: a reader served the screen — an untracked read, a frame reader
 * served the committed value, a verdict reader (`serve`) — reads a shown
 * error there until the answer that replaces it commits. */
function throwShown(el: Signal<any> | Computed<any>): undefined {
  if (el._x?._shownError) {
    if (__DEV__) noteThrownRead(el, el._x._shownError);
    throw el._x._shownError;
  }
}

/**
 * Rule 1, the one slow implementation (DESIGN-CONSOLIDATION move 3b, step
 * 6c): the value a reader `c` (null = untracked, no pass) is served from
 * `el`. Called by read()'s slow tail; the fast path (read's fast block) keeps
 * its trivial ternary by design (perf, see the doc). Arms, in order:
 * - a node born staged has nothing for an untracked reader (A19 exception 1);
 * - an unflushed write serves committed and re-runs the reader in the
 *   carrying flush (A28);
 * - readerSeesCommitted, else the staged value.
 */
export function serve(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  // A node born staged (recompute) has a staged value and no committed one:
  // an untracked reader has nothing to serve and holds (A19 exception 1) — a
  // bookkeeping read (`spectate`) likewise, and a children-forbidden reader
  // (A32: the frame, which has nothing here).
  if (
    el._pendingValue !== NOT_PENDING &&
    (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED &&
    (!c || spectating || c._config & CONFIG_CHILDREN_FORBIDDEN)
  ) {
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
    // (A held node's stash is its flushed staging: the staging's slot.)
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
  // D-8 (#4452), as `read`'s fast block: a signal's staging equal to its
  // committed value is writes that netted — no proposal, not a read of the
  // frame's future. Only the strict `untrack` read skips the fast block in
  // dev (its `strictRead` test); a hydration snapshot or a promoted write
  // reaches here in dev and prod alike, and keeps the mark.
  if (
    !(__DEV__ && strictRead) ||
    (el as Computed<any>)._fn ||
    el._pendingValue !== el._value ||
    !Object.is(el._pendingValue, el._value)
  )
    stagedRead(c!, el);
  // D-41: the staged answer is an error (`stageError`).
  if (el._config & CONFIG_STAGED_ERROR) {
    if (__DEV__) noteThrownRead(el, el._pendingValue);
    throw el._pendingValue;
  }
  if (__TEST__) shadowActual(SLOT_P);
  return el._pendingValue;
}

/** Shadow (S0, `seat.ts`): run `read` once for real and compare the slot it
 * served with the table's prediction recorded at the decision point. A
 * throw is a slot too: NotReady is NR, anything else E. */
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

/** A pass read a staging of this flush: it derives from what the flush may
 * yet hold (REACTIVE_STAGED_READ — the seam decides). Lane work too (plan sec. 28, a
 * lane sees the screen plus its own guesses) — a folded lane's only before
 * the frame has a transaction (after, it reads the screen like a verdict
 * reader, `stagedScreen` — a list pass never pairs a held length with the
 * guess's rows, D-34): the staging is the screen if
 * the frame commits — one pass, the common case — and a held write if it
 * parks, which the seam repairs (`stagedReaders`): the pass re-derives on
 * the committed world and its lane's runs wait that round, so the held
 * write never shows through the lane. A verdict lane's work likewise: the
 * lane holds verdicts, not the frame's other stagings (#3851) — except a
 * verdict reader, which answered for itself (the lane seam, lanes.ts). Not
 * a read of a node born staged at all: it has no committed value to
 * re-derive on, and a re-run would read the same staging and re-queue every
 * round (#3969: nor does it make a later lane read a re-derive, `enterLane`). */
export function stagedRead(c: Computed<any>, el?: Signal<any> | Computed<any>): void {
  if (!((el as Computed<any> | undefined)?._statusFlags! & STATUS_UNINITIALIZED)) {
    c._flags |= REACTIVE_STAGED_READ;
    if (__TEST__) shadowExternalRaise(c, RAISE_FL);
    // A verdict reader's too when it is an effect, before the frame has a
    // transaction (after, `stagedScreen` serves it the screen): the staging
    // is the frame's read, and the pass re-derives once as a verdict reader
    // if the flush parks (D-22; D-25: the probe decides the posture in either
    // read order). A memo's is the frame's derivation either way: a memo is
    // not a leaf (`frameRead`).
    if (laneSeamsHook && (passLane !== null || ((c as any)._type && c._config & CONFIG_VERDICT)))
      stagedReaders.push(c);
  }
}

/** A10 for a staged node: a verdict reader (the pass entered a window) that
 * also reads a frame's proposal plainly sees the screen — `[latest(q), q()]`
 * is `[b, a]` — once the frame has a transaction, and re-derives when it
 * lands: at this very seam if nothing holds it (the stale run is void,
 * #3322 — one run, on the committed world), or with the hold. Before any
 * transaction the answer is the seam's and the reader watches it
 * (verdict.ts). A node born into the future has no screen: its staging is
 * its only value (A29). Nor has a reader born into the flush's transaction
 * (`bornInto`, #4010): its branch exists only there — nor, reading `el` a
 * hold holds, one born into that hold, whichever flush runs it (D-25: the
 * hold's own work reads plainly). A held node `read` brings here is one
 * `frameRead` found the reader born into: every other it served the screen
 * (a lane's node it never asks — CONFIG_OVERRIDE; #4426). */
export function stagedScreen(c: Computed<any>, el?: Signal<any> | Computed<any>): boolean {
  if (
    flushTransaction === null ||
    bornInto(c, flushTransaction) ||
    (el?._config! & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD
  )
    return false;
  // A transaction only a `latest()` read opened holds nothing: the staging
  // is the frame's read for a pass in the frame's seat, as it is before the
  // frame has one, and the seam re-derives the pass once only if the flush
  // parks (D-22, F-10). Lane work sees the screen (D-37). Not a pass with no
  // value yet: its first answer is nobody's hold (D-6) and would commit the
  // staging whether or not the frame parks — it reads the screen, and runs
  // again at the landing.
  if (
    observeFlightHook &&
    flushTransaction === latestOpened &&
    passLane === null &&
    c._config & CONFIG_VERDICT &&
    !(c._statusFlags & STATUS_UNINITIALIZED)
  )
    return !stagedReaders.push(c);
  staleReader(c, flushTransaction);
  return true;
}

export function ownedScopeWriteMessage(owner: Owner): string {
  const name = (owner as any)._name;
  return name
    ? `${REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE} (in ${name})`
    : REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE;
}

/** A28 (4) — written inside a recompute that runs OUTSIDE a flush (a
 * creation-time compute): promoted at that pass's end, visible to the rest of
 * the block. Cold: only contextual writes reach here. */
export function notePromotedWrite(el: Signal<any> | Computed<any>): void {
  if (globalQueue._running || el._config & CONFIG_PROMOTED) return;
  el._config |= CONFIG_PROMOTED;
  promotedWrites.push(el);
}

/** Cold half of setSignal's snapshot arm (see there), shared with a store
 * container's structural notify: first write during capture to a plain
 * signal without a live snapshot records the pre-write value. Only plain
 * user signals qualify. Computeds reach setSignal from an
 * async landing (asyncWrite), and a value arriving from async during the pass
 * REVEALS — the creation-time arm skips pending computeds for the same
 * reason. Firewall leaves belong to a projection whose compute is the tree's
 * own work, captured (or deliberately not) at creation. */
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

/**
 * A callback run before every signal or store write lands, while set, with
 * the written signal or the store proxy whose setter runs. The
 * server-components client sets it while slot occurrences are left
 * unmounted after hydration (deferred hydration): a write may be one an
 * unmounted component would have observed, so the client mounts what is
 * left before the write applies, and clears the hook. `null` otherwise.
 */
export let writeHook: ((node?: object) => void) | null = null;
/** @internal */
export function setWriteHook(hook: ((node?: object) => void) | null): void {
  writeHook = hook;
}

/**
 * `el`'s comparator verdict (`_equals`), the one guarded call for recompute,
 * setSignal (user setters and async landings) and the seam's
 * staged-equals-committed check.
 * - A comparator that read an unresolved async source has not shown the
 *   values equal (#4111): falsy, a change, whose readers suspend in their own
 *   tracked context.
 * - Any other throw is an error of `el`'s computation (A3, #2837): routed
 *   through the status path so error boundaries contain it, instead of
 *   unwinding a flush or a setter; answered "same" so nothing commits.
 * @internal
 */
export function isSame(el: Signal<any>, a: unknown, b: unknown): unknown {
  if (el._equals === isEqual) return a === b;
  try {
    return el._equals && el._equals(a, b);
  } catch (e) {
    // D-42 (dev): a comparator's throw is `el`'s (routed here), not a catch
    // in the pass that happens to be running (the creator's, at a mount).
    if (__DEV__) forgetThrownRead();
    if (!(e instanceof NotReadyError))
      return (notifyStatus(el as Computed<any>, STATUS_ERROR, e), true);
  }
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  if (writeHook !== null) writeHook(el);
  if (
    __DEV__ &&
    !(el._config & CONFIG_OWNED_WRITE) &&
    !(context && context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    context &&
    !disposalDepth
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

  // Lanes: a write landing on a guess is its truth (A18 — an async guess's
  // own landing), judged against the guess; one landing on a lane's
  // derivation (its flight) is the lane's staging (lanes.ts).
  if (laneWriteHook && el._config & CONFIG_OVERRIDE) return laneWriteHook(el, v);
  // L2 (T4) / A34 (1): a write to a node whose staged state is held is a
  // second proposal for the slot — the same value again or another — and
  // the two cannot finish at different times: the writer's tick joins the
  // hold, before the equality gate.
  if (el._config & CONFIG_HELD) joinFuture(txOf(el));
  // Uninitialized check first: the first commit has no previous value, so the
  // user comparator must not run against `undefined` (matches recompute).
  // D-41: a write over a shown error is a change whatever the last good
  // value was — the error leaves at its commit (`commitPendingNode`).
  // `custom`: with the verdict engine, whether `el` carries a comparator of
  // its own — `isSame`'s fast-path test, taken once for this gate and D-8's
  // netting below, so the default comparator's `===` runs inline and a
  // rewrite loop pays nothing for the netting (CodSpeed `propagation:
  // avoidable`). Without the engine it is `null`: the gate folds to the
  // plain `isSame` call and the netting away, byte for byte as before.
  const custom = observeFlightHook ? el._equals !== isEqual : null;
  const valueChanged =
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED) ||
    !!el._x?._shownError ||
    (custom === false ? currentValue !== v : !isSame(el, currentValue, v));
  if (!valueChanged) return v;

  // Attribution hook: this committed write is where a re-run chain begins.
  if (__OBSERVE__ && attrHooks !== null) attrHooks.write(el, currentValue, v);

  // A write during hydration's snapshot capture to a source that has no
  // snapshot — created BEFORE capture began (module-level state: an identity
  // minted from onSettled in the pass, a preference read from storage) —
  // captures the pre-write value now, so the write is held like any other:
  // in-scope readers keep serving what the server rendered with and replay
  // at release. Left uncaptured, the write cascades live through a claim
  // pass whose DOM writes are skipped, and a component rendered later in the
  // pass reads a value the server never had. Store leaves written here are
  // plain signals and qualify the same way.
  if (snapshotCaptureActive) captureWriteSnapshot(el, currentValue);

  const wasStaged = el._pendingValue !== NOT_PENDING;
  if (!wasStaged) queuePendingNode(el);
  // A28: a held node rewritten outside a flush keeps its flushed staging
  // for every reader until the flush that carries the rewrite.
  else if (el._config & CONFIG_HELD && !globalQueue._running) stashFlushed(el);
  // D-8 (#4483): a staged rewrite the comparator calls equal to the
  // committed value nets to it; staging the committed value itself lets
  // every netted test (`_pendingValue === _value`) see writes that made no
  // proposal. (Unstaged, the gate above already compared it.)
  // The netted test reads it only with the verdict engine (`isPending`,
  // `latest`): a build without it stages `v` as written. Under the default
  // comparator only the committed object itself is equal, and `v` is already
  // it, so a rewrite loop pays one local test (`custom`, from the gate).
  // (`custom` is truthy only with the engine installed.)
  el._pendingValue =
    custom &&
    wasStaged &&
    !((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED || el._x?._shownError) &&
    isSame(el, el._value, v)
      ? el._value
      : v;
  // A28 arm, gated on the load the write already pays for (`context`); the
  // arm itself is a cold helper so setSignal stays within every setter's
  // inlining budget, ~300 B bytecode.
  if (__DEV__) devTrackHeldPending(el);
  if (context !== null) notePromotedWrite(el);

  // _time is a computed-only slot (§12e): writing it on a signal would fork
  // the lean shape. Every read site is computed-typed.
  if ((el as any)._fn !== undefined) el._time = clock;
  // Staged-rewrite fast path (§12d): a re-write to a node whose subscribers
  // were already walked — and where nothing has recomputed or linked since
  // (epoch) — re-stages the value and stops. The walk is idempotent (subs
  // marked, heap entries flag-guarded, effects queued once).
  if (wasStaged && el._notifiedAt === notifyEpoch) return v;
  insertSubs(el);
  schedule();
  return v;
}

/**
 * User-facing setter for the memo form of `createSignal(fn)`. A write applies
 * first, then derivations re-run (A34 as amended 2026-10-01, rule B; core
 * R31): the write stages like any other, and a source change — in this flush
 * or a later one, under a hold or on mainline — re-derives with the staged
 * write as `prev`. The write never refuses the re-run (the frame-scoped mask
 * of #3733/#3740 and #2692's "write wins the tick" before it are gone; call
 * order inside a flush was never observable) and on its own never causes one.
 * REACTIVE_MANUAL_WRITE only marks the staging as a user proposal — the A34
 * (1)/(3) discriminator — until a pass re-derives it or the commit lands it.
 */
export function setMemo<T>(el: Computed<T>, v: T | ((prev: T) => T)): T {
  // A34 (3), #3612: is `el`'s staging a derivation another transaction holds
  // — held, not a manual proposal, and the writer not that transaction
  // (mainline, or a flush joined elsewhere)? A held pass result is nobody's
  // proposal: a setter reaching it composes on the committed frame it was
  // written against and becomes `prev` for the hold's re-derivation, instead
  // of replacing it. A write made under the hold carries the mark and keeps
  // (1)'s last-write-wins. Only the user setter asks; an async landing
  // writing a held node is the transaction's own work.
  const held =
    el._config & CONFIG_HELD &&
    !(el._flags & REACTIVE_MANUAL_WRITE) &&
    txOf(el) !== flushTransaction;
  // The writer read the committed frame; its updater composes on it.
  if (held && typeof v === "function") {
    const value = (v as (prev: T) => T)(el._value);
    v = () => value;
  }
  // #4110: the write replaces a failed derivation's outcome. It lands without
  // re-running `_fn`, and nothing else clears STATUS_ERROR, so without this
  // every later read keeps throwing the error the derivation left behind.
  // The error stays the display until the write commits (D-41).
  if (el._statusFlags & STATUS_ERROR) {
    el._x!._shownError = el._x!._error;
    notifyStatus(el, STATUS_NONE);
  }
  v = setSignal(el, v);
  // A write replaces an error a pass staged (D-41): it is a value again.
  el._config &= ~CONFIG_STAGED_ERROR;
  if (held) {
    // The one write that re-runs: the staging it replaced was derived from
    // inputs the writer never saw, so the hold re-derives over the write.
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

/**
 * Core marking half of `refresh()` (the public wrapper lives in signals.ts —
 * it validates the target, marks through here, then builds the quiescence
 * promise on the resolve()/until() effect machinery). Flags the node's next
 * recompute as a quiet re-ask and schedules it; no-ops for non-derived or
 * disposed targets.
 */
export function markRefresh(node: Computed<any>): void {
  if (
    __DEV__ &&
    context &&
    !((node._config ?? 0) & CONFIG_OWNED_WRITE) &&
    !(context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    !disposalDepth
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
  if (typeof node._fn === "function" && !(node._flags & REACTIVE_DISPOSED)) {
    // A manual write never refuses the re-run (A34 rule B): a refresh in the
    // write's own frame re-asks with the write as `prev`, like any source
    // change (#3026 generalized).
    // The re-ask of an answered question (A19 exc. 2): the next pass, going
    // pending, classifies its flight quiet for the verdict. Not when an
    // input already changed this tick — that pass asks a new question.
    node._flags =
      (node._flags & ~REACTIVE_CHECK) |
      REACTIVE_DIRTY |
      (node._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP) ? 0 : REACTIVE_REASK);
    // A refresh() self-invalidation is a root cause too — the target's next
    // run has no changed dep to point at, so it points here instead.
    if (__OBSERVE__ && attrHooks !== null) attrHooks.refreshed(node);
    insertIntoHeap(node, dirtyQueue);
    schedule();
  }
}
