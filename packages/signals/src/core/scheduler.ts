import {
  CONFIG_IN_SNAPSHOT_SCOPE,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  CONFIG_HAS_COMPANIONS,
  CONFIG_HAS_LANE,
  CONFIG_HAS_SNAPSHOT,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_MISSED_WAKE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_REASK,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { currentOptimisticLane, ext } from "./core.js";
import { DEV, emitDiagnostic } from "./dev.js";
import { NotReadyError } from "./error.js";
import { sweepDormant } from "./graph.js";
import { deleteFromHeap, enqueueSub, runHeap, type Heap } from "./heap.js";
import {
  activeLanes,
  assignOrMergeLane,
  findLane,
  signalLanes,
  type OptimisticLane
} from "./lanes.js";
import {
  beginAsyncReporterWrites,
  createAsyncReporters,
  devCensusCompanions,
  devCheckActiveOverrides,
  devCheckFlushStart,
  devCheckQuiescent,
  endAsyncReporterWrites
} from "./invariants.js";
import type { Computed, Signal } from "./types.js";

export { activeLanes, assignOrMergeLane, findLane };
export { getOrCreateLane, hasActiveOverride, mergeLanes, resolveLane } from "./lanes.js";

const transitions = new Set<Transition>();
export const dirtyQueue: Heap = {
  _heap: new Array(2000).fill(undefined),
  _marked: false,
  _min: 0,
  _max: 0
};
export const zombieQueue: Heap = {
  _heap: new Array(2000).fill(undefined),
  _marked: false,
  _min: 0,
  _max: 0
};

/** runHeap callback that discards a queued zombie recompute instead of running
 * it: unlink pure recompute entries; strip just the recompute bit from dirtied
 * height-adjust entries so their height work still happens. */
function cancelZombieRecompute(el: Computed<unknown>): void {
  if (el._flags & REACTIVE_IN_HEAP_HEIGHT)
    el._flags &= ~(REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK);
  else {
    deleteFromHeap(el, zombieQueue);
    el._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK);
  }
}

export let clock = 0;
export let activeTransition: Transition | null = null;
let scheduled = false;
let halted = false;
let haltNotified = false;
let syncDepth = 0;
export let projectionWriteActive = false;
let inTrackedQueueCallback = false;

let _enforceLoadingBoundary = false;
export let _hitUnhandledAsync = false;

// Store property nodes that were created solely to carry a pending write (no
// subscribers at write time). Swept after each flush that commits pending
// values — any still without subs get disposed via their `_unobserved` hook,
// releasing the slot in the parent store's node map.
const transientStoreNodes = new Set<Signal<any>>();

function canUseSimpleSyncFlush(queue: GlobalQueue): boolean {
  const batch = queue._batch;
  return (
    transitions.size === 0 &&
    activeLanes.size === 0 &&
    queue._children.length === 0 &&
    batch._optimisticNodes.length === 0 &&
    batch._affectsNodes.length === 0 &&
    batch._optimisticStores.size === 0 &&
    transientStoreNodes.size === 0
  );
}

function sweepTransientStoreNodes(): void {
  if (transientStoreNodes.size === 0) return;
  for (const node of transientStoreNodes) {
    if (node._subs !== null) {
      transientStoreNodes.delete(node);
      continue;
    }
    if (node._pendingValue !== NOT_PENDING) continue;
    if (node._x?._overrideValue !== undefined && node._x?._overrideValue !== NOT_PENDING) continue;
    // A live affects() mark keeps the node addressable: sweeping it would
    // detach the refcount from the slot (a fresh probe would upsert a new,
    // unmarked node for the same property).
    if (node._x?._affectsCount) continue;
    transientStoreNodes.delete(node);
    node._x?._unobserved?.();
  }
}
export function resetUnhandledAsync(): void {
  _hitUnhandledAsync = false;
}
/**
 * Toggles the dev-mode "must be inside a `<Loading>` boundary" enforcement
 * window. Only `render()` calls this — wrapping the initial mount so that a
 * top-level uncaught async read surfaces the diagnostic. Not part of the
 * user-facing API.
 *
 * @internal
 */
export function enforceLoadingBoundary(enabled: boolean): void {
  _enforceLoadingBoundary = enabled;
}

export function setProjectionWriteActive(value: boolean) {
  projectionWriteActive = value;
}

export function setTrackedQueueCallback(value: boolean) {
  if (__DEV__) inTrackedQueueCallback = value;
}

// Dev-only marker for the effect half of createEffect/createRenderEffect, so
// flush() can report the no-op instead of failing silently (React parity).
let inEffectCallback = false;

export function setEffectCallback(value: boolean) {
  if (__DEV__) inEffectCallback = value;
}

export type QueueCallback = (type: number) => void;
type QueueStub = {
  _queues: [QueueCallback[], QueueCallback[]];
  _children: QueueStub[];
};
type OptimisticNode = Signal<any> | Computed<any>;
export interface Transition {
  _time: number;
  _asyncReporters: Map<Computed<any>, Set<Computed<any>>>;
  _pendingNodes: Signal<any>[];
  _optimisticNodes: OptimisticNode[]; // Optimistic signals/computeds pending transition reversion
  // Live affects() marks owned by this transaction: one entry per
  // registration; each releases one refcount at settle/revert.
  _affectsNodes: OptimisticNode[];
  _optimisticStores: Set<any>;
  _actions: Array<Generator<any, any, any> | AsyncGenerator<any, any, any>>;
  _queueStash: QueueStub;
  _done: boolean | Transition;
  // Subscribers that, while recomputing under an optimistic lane, read a plain
  // signal's committed value through the entanglement gate. At commit they
  // get rescheduled so they re-run with the new committed view.
  _gatedSubs: Set<Computed<any>>;
}

/**
 * Ambient work IS a transaction: the global queue always carries one
 * current-transaction-shaped batch (`globalQueue._batch`). With no transition
 * active, registrations (pending commits, optimistic nodes, affects marks,
 * optimistic stores) land in a plain ambient batch that the plain flush
 * finalizes; when a transition initializes it adopts the ambient batch's
 * contents and `_batch` becomes the transition itself, so later registrations
 * land there directly — no per-field aliasing.
 */
function createBatch(): Transition {
  return {
    _time: clock,
    _pendingNodes: [],
    _asyncReporters: __DEV__ ? createAsyncReporters() : new Map(),
    _optimisticNodes: [],
    _affectsNodes: [],
    _optimisticStores: new Set(),
    _actions: [],
    _queueStash: { _queues: [[], []], _children: [] },
    _done: false,
    _gatedSubs: new Set()
  };
}

function mergeTransitionState(target: Transition, outgoing: Transition): void {
  outgoing._done = target;
  target._actions.push(...outgoing._actions);
  for (const lane of activeLanes) if (lane._transition === outgoing) lane._transition = target;
  if (outgoing._optimisticNodes.length) {
    // Move (don't copy): the global queue's batch may still be the outgoing
    // transition, and the adoption pass in initTransition would re-push its
    // contents into the target — duplicating every entry.
    target._optimisticNodes.push(...outgoing._optimisticNodes);
    outgoing._optimisticNodes.length = 0;
  }
  if (outgoing._affectsNodes.length) {
    // Move (don't copy): the global queue's batch may still be the outgoing
    // transition, and the adoption pass in initTransition would re-push its
    // contents into the target — double-releasing every mark.
    target._affectsNodes.push(...outgoing._affectsNodes);
    outgoing._affectsNodes.length = 0;
  }
  for (const store of outgoing._optimisticStores) target._optimisticStores.add(store);
  // Patch-channel stash (store/next/patch.ts): entries held for the outgoing
  // transition must ride the merge like every other per-transition
  // collection — releaseBatch only reads the COMMITTING transition's stash,
  // so a stranded sidecar would silently drop its patches. Move (don't
  // copy), same aliasing rule as the collections above. The field is an
  // expando so this module stays free of patch imports (pay-for-use).
  const heldPatches = (outgoing as any)._heldPatches as unknown[] | undefined;
  if (heldPatches !== undefined) {
    (outgoing as any)._heldPatches = undefined;
    let dest = (target as any)._heldPatches as unknown[] | undefined;
    if (dest !== undefined) dest.push(...heldPatches);
    else dest = (target as any)._heldPatches = heldPatches;
    // Retarget the entries' coalescing stamps to the surviving stash
    // (opaque backref contract with store/next/patch.ts): without this a
    // post-merge emission misses the stamp and pushes a SECOND entry —
    // the record's patch applies twice at commit (re-audit 5, P1-2).
    for (let i = 0; i < heldPatches.length; i++) {
      const pc = (heldPatches[i] as any).pc;
      if (pc !== undefined && pc.qe === heldPatches[i]) pc.qa = dest;
    }
  }
  // Legal transfer, not a new registration: entries move between transitions.
  if (__DEV__) beginAsyncReporterWrites();
  for (const [source, reporters] of outgoing._asyncReporters) {
    let targetReporters = target._asyncReporters.get(source);
    if (!targetReporters) target._asyncReporters.set(source, (targetReporters = new Set()));
    for (const reporter of reporters) targetReporters.add(reporter);
  }
  if (__DEV__) endAsyncReporterWrites();
  for (const sub of outgoing._gatedSubs) target._gatedSubs.add(sub);
}

export function schedule() {
  if (halted) {
    notifyHalted();
    return;
  }
  if (scheduled) return;
  scheduled = true;
  if (!syncDepth && !globalQueue._running && !projectionWriteActive) queueMicrotask(flush);
}

/**
 * Permanently halts the reactive system. Called when a user error escapes
 * every boundary — app state is undefined at that point, so scheduling stops
 * entirely rather than limping along with a half-applied update.
 */
export function haltReactivity(cause?: unknown): void {
  if (halted) return;
  halted = true;
  let message = "[REACTIVITY_HALTED]";
  if (__DEV__) {
    message +=
      " An uncaught error halted the reactive system. No further updates will be processed. Handle errors with createErrorBoundary/<Errored> or treat this as a crash.";
    emitDiagnostic({
      code: "REACTIVITY_HALTED",
      kind: "error",
      severity: "error",
      message
    });
  }
  // Log the cause here too: callers rethrow it, but a creation-time throw
  // unwinds through ancestor recomputes that convert it to status instead of
  // surfacing it (#2884), so the rethrow alone cannot guarantee visibility.
  cause === undefined ? console.error(message) : console.error(message, cause);
}

// Logs on the first write after a halt so a frozen interaction is traceable.
function notifyHalted(): void {
  if (haltNotified) return;
  haltNotified = true;
  console.error(
    __DEV__
      ? "[REACTIVITY_HALTED] Update ignored: the reactive system was halted by an earlier uncaught error."
      : "[REACTIVITY_HALTED]"
  );
}

/** @internal Test/dev-reload hook. Revives scheduling after a halt. */
export function resetErrorHalt(): void {
  halted = false;
  haltNotified = false;
}

export interface IQueue {
  enqueue(type: number, fn: QueueCallback): void;
  run(type: number): boolean | void;
  addChild(child: IQueue): void;
  removeChild(child: IQueue): void;
  created: number;
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean;
  stashQueues(stub: QueueStub): void;
  restoreQueues(stub: QueueStub): void;
  _parent: IQueue | null;
}

// Identifies one child-traversal pass in `Queue.run` so a rescan after the
// child list shifts can tell "already run this pass" from "still pending".
let queueRunToken = 0;

export class Queue implements IQueue {
  _parent: IQueue | null = null;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _children: IQueue[] = [];
  _ranAt = 0;
  created = clock;
  addChild(child: IQueue) {
    this._children.push(child);
    child._parent = this;
  }
  removeChild(child: IQueue) {
    const index = this._children.indexOf(child);
    if (index >= 0) {
      this._children.splice(index, 1);
      child._parent = null;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    if (this._parent) return this._parent.notify(node, mask, flags, error);
    return false;
  }
  run(type: number) {
    if (this._queues[type - 1].length) {
      const effects = this._queues[type - 1];
      this._queues[type - 1] = [];
      runQueue(effects, type);
    }
    // Effects run here can dispose owners, and disposal removes queues from
    // this list — the running child itself, an earlier sibling, or several at
    // once. A plain index walk then skips whatever shifted into the cursor.
    // Stamping each child before it runs makes the pass idempotent, so a shift
    // can be recovered by rescanning from the front and every child still runs
    // exactly once. Children appended mid-pass carry a stale stamp and run,
    // matching the previous live-array behaviour.
    const children = this._children;
    const token = ++queueRunToken;
    for (let i = 0; i < children.length; ) {
      const child = children[i] as Queue;
      if (child._ranAt !== token) {
        child._ranAt = token;
        (child as any).run?.(type);
        if (children[i] !== child) {
          i = 0;
          continue;
        }
      }
      i++;
    }
  }
  enqueue(type: number, fn: QueueCallback): void {
    if (type) {
      // Route to lane's effect queue if we're in an optimistic recomputation
      if (currentOptimisticLane) {
        const lane = findLane(currentOptimisticLane);
        lane._effectQueues[type - 1].push(fn);
      } else {
        this._queues[type - 1].push(fn);
      }
    }
    schedule();
  }
  stashQueues(stub: QueueStub): void {
    stub._queues[0].push(...this._queues[0]);
    stub._queues[1].push(...this._queues[1]);
    this._queues = [[], []];
    for (let i = 0; i < this._children.length; i++) {
      let child = this._children[i];
      let childStub = stub._children[i];
      if (!childStub) {
        childStub = { _queues: [[], []], _children: [] };
        stub._children[i] = childStub;
      }
      child.stashQueues(childStub);
    }
  }
  restoreQueues(stub: QueueStub) {
    this._queues[0].push(...stub._queues[0]);
    this._queues[1].push(...stub._queues[1]);
    for (let i = 0; i < stub._children.length; i++) {
      const childStub = stub._children[i];
      let child = this._children[i];
      if (child) child.restoreQueues(childStub);
    }
  }
}

export class GlobalQueue extends Queue {
  _running: boolean = false;
  // The current transaction-shaped batch: a plain ambient batch while no
  // transition is active, the active transition itself after initTransition.
  _batch: Transition = createBatch();
  static _update: (el: Computed<unknown>) => void;
  static _dispose: (el: Computed<unknown>, self: boolean, zombie: boolean) => void;
  static _runEffect: (el: Computed<unknown>) => void;
  static _clearOptimisticStores:
    | ((stores: Set<any>, completing: Transition | null) => void)
    | null = null;
  // Store-side hook: drops a keyless affects() mark's identity scope when the
  // carrier node's last registration releases (wired by store.ts, mirroring
  // _clearOptimisticStore).
  static _releaseAffectsScope: ((node: OptimisticNode) => void) | null = null;
  // affects()-side hooks (wired by affects.ts, mirroring _update): the mark
  // engine — count/register/release — lives with the feature. Every call site
  // is gated by state only that module creates, so `!` invocations are safe
  // once the gate holds.
  static _releaseAffectsMarks: ((nodes: OptimisticNode[]) => void) | null = null;
  static _markAffects: ((node: OptimisticNode) => void) | null = null;
  static _releaseAffectsMark: ((node: OptimisticNode) => void) | null = null;
  // External-source bridge (wired by enableExternalSource(); null while no
  // config is active — including after _resetExternalSourceConfig()).
  static _wireExternalSource: ((self: Computed<any>) => void) | null = null;
  static _externalUntrack: (<T>(fn: () => T) => T) | null = null;
  // Verdict-layer hooks (wired by verdict.ts when isPending()/latest() are
  // imported; null in apps that never use them). Call sites either guard for
  // null or sit behind state only the verdict layer can create (`!` is safe
  // there: `_pendingSignal`/`_latestValueComputed` are only ever assigned by
  // verdict.ts, and `pendingCheckActive`/`latestReadActive` only flip inside
  // isPending()/latest()).
  static _syncCompanions: (<T>(el: Signal<T> | Computed<T>, value: T) => void) | null = null;
  static _updatePendingSignal: ((el: OptimisticNode) => void) | null = null;
  static _updateChildCompanions: ((el: Computed<any>) => void) | null = null;
  static _snapCompanions: ((el: OptimisticNode) => void) | null = null;
  static _latestRead: (<T>(el: Signal<T> | Computed<T>) => T) | null = null;
  static _pendingCheck:
    | ((
        el: OptimisticNode,
        c: Computed<any> | null,
        owner: OptimisticNode,
        firewall: Computed<any> | null
      ) => void)
    | null = null;
  static _recordFresh: ((el: OptimisticNode, value: any) => void) | null = null;
  static _applyReask: ((el: Computed<any>, hadReask: boolean) => boolean) | null = null;
  static _repollVerdicts: ((el: Computed<any>, snap?: boolean) => void) | null = null;
  static _witnessAffects: ((node: OptimisticNode) => void) | null = null;
  // Re-asks probes whose verdict was provisionally suppressed by a fresh read
  // of a held value, once the transaction gains an async blocker (#3028).
  static _wakeSuppressedProbes: ((transition: Transition) => void) | null = null;
  // Optimistic-engine hooks (wired by core/optimistic.ts via
  // installOptimisticEngine(), called from verdict.ts / createOptimistic /
  // createOptimisticStore — every module that can create optimistic state).
  // Call sites are gated by state only the engine can create: an
  // `_overrideValue` slot, a lane in `activeLanes`, an `_optimisticNodes`
  // entry, or a non-null `currentOptimisticLane`, so `!` invocations are safe
  // once the gate holds.
  static _optimisticWrite: (<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)) => T) | null =
    null;
  static _resolveOptimistic: ((nodes: OptimisticNode[]) => void) | null = null;
  static _transitionBlocked: ((transition: Transition) => boolean) | null = null;
  static _cleanupLanes: ((completingTransition: Transition | null) => void) | null = null;
  static _runLaneEffects: ((type: number) => void) | null = null;
  /** Patch-channel optimistic drain (next/patch.ts): optimistic emissions
   * apply at lane-effect timing — visible in flight, unlike the regular
   * effect queues an action stashes. Injected; null when unused. */
  static _drainPatchOptimistic: (() => void) | null = null;
  static _gatedRead:
    | ((el: Signal<any>, owner: OptimisticNode, c: Computed<any>) => boolean)
    | null = null;
  static _laneSuspends: ((owner: OptimisticNode) => boolean) | null = null;
  static _laneReadsCommitted:
    | ((el: OptimisticNode, owner: OptimisticNode, c: Computed<any>) => boolean)
    | null = null;
  static _recomputeLane:
    | ((el: Computed<any>, own: boolean) => OptimisticLane | null | false)
    | null = null;
  static _laneAsyncPending: ((el: Computed<any>) => void) | null = null;
  /** Authoritative-view reader wakeup (until()): installed at first until() call.
   * Call sites are gated by CONFIG_AUTHORITATIVE_OBSERVED, which only until()'s
   * carve-out read can set, so `!` invocations are safe once the gate holds. */
  static _notifyAuthoritativeObservers: ((el: Signal<any> | Computed<any>) => void) | null = null;
  static _laneAsyncSettled: ((el: Computed<any>) => void) | null = null;
  static _trackOptimisticStore: ((store: any) => void) | null = null;
  flush() {
    if (this._running) return;
    // Fast drain: nothing in flight but plain pending commits — no dirty
    // computeds, no queued effects, no child queues, no transitions/lanes/
    // optimistic state. Commit and go; anything a commit hook schedules
    // (companion snaps, store folds notifying subs) re-arms `scheduled`
    // below and the outer drain loop takes the full spine next round.
    if (
      !__DEV__ &&
      activeTransition === null &&
      dirtyQueue._max < dirtyQueue._min &&
      this._queues[0].length === 0 &&
      this._queues[1].length === 0 &&
      this._children.length === 0 &&
      canUseSimpleSyncFlush(this)
    ) {
      this._running = true;
      try {
        // Sweep first: unobserved() pulls swept nodes out of the dirty heap,
        // so a dormant memo dirtied in the same tick is reclaimed instead of
        // recomputed (matching the old inline dispose-on-read counts).
        sweepDormant();
        commitPendingNodes();
      } finally {
        this._running = false;
      }
      clock++;
      scheduled =
        dirtyQueue._max >= dirtyQueue._min ||
        this._queues[0].length !== 0 ||
        this._queues[1].length !== 0 ||
        this._batch._pendingNodes.length !== 0;
      return;
    }
    this._running = true;
    try {
      if (__DEV__) devCheckFlushStart();
      // Before runHeap for the same reason as the fast drain above; late
      // subscribers (an effect reading a swept memo this flush) revive it,
      // which is the pay-for-use contract.
      sweepDormant();
      runHeap(dirtyQueue, GlobalQueue._update);
      if (activeTransition) {
        const isComplete = transitionComplete(activeTransition);
        if (!isComplete) {
          const stashedTransition = activeTransition!;
          // When the parking batch IS the transition, all of its writes commit
          // only with it — every zombie recompute they queued would run against
          // a world the zombie never displays (zombies render mainline until
          // commit), so cancel them instead of running them. Only an ambient
          // batch's mainline writes (the #2916 shape below) legitimately reach
          // zombies here. Height-adjust entries still process normally: a
          // dirtied one keeps its height flag and falls through to runHeap's
          // adjustHeight path on the next pass of the bucket.
          runHeap(
            zombieQueue,
            this._batch === stashedTransition ? cancelZombieRecompute : GlobalQueue._update
          );
          // Detach: the stashed transition keeps its batch; ambient work that
          // follows lands in a fresh one. If the batch is already a separate
          // ambient one — action done() restored activeTransition without
          // adopting the batch, and an ordinary write landed there before
          // the scheduled flush (#2916) — keep it: replacing it would strand
          // its queued pending nodes with held _pendingValues forever.
          if (this._batch === stashedTransition) currentBatch = this._batch = createBatch();

          // Run lane effects immediately (before stashing) - lanes with no pending async
          if (activeLanes.size) {
            GlobalQueue._runLaneEffects!(EFFECT_RENDER);
            GlobalQueue._runLaneEffects!(EFFECT_USER);
          }

          this.stashQueues(stashedTransition._queueStash);
          clock++;
          // A kept ambient batch may hold pending nodes (#2916): stay
          // scheduled so the outer drain loop commits them via the plain
          // flush path instead of leaving them until the next natural flush.
          scheduled = dirtyQueue._max >= dirtyQueue._min || this._batch._pendingNodes.length > 0;
          reassignPendingTransition(stashedTransition._pendingNodes);
          activeTransition = null;
          finalizePureQueue(null, true);
          return;
        }
        const completingTransition = activeTransition;
        const batch = this._batch;
        batch !== completingTransition &&
          batch._pendingNodes.push(...completingTransition._pendingNodes);
        this.restoreQueues(completingTransition._queueStash);
        transitions.delete(completingTransition);
        activeTransition = null;
        reassignPendingTransition(batch._pendingNodes);
        finalizePureQueue(completingTransition);
        if (batch === completingTransition) {
          // Drop the dead Transition wrapper but keep its (drained) containers
          // as the ambient batch — late registrations during finalization live
          // there and must survive to the next flush.
          const fresh = createBatch();
          fresh._pendingNodes = batch._pendingNodes;
          fresh._optimisticNodes = batch._optimisticNodes;
          fresh._affectsNodes = batch._affectsNodes;
          fresh._optimisticStores = batch._optimisticStores;
          currentBatch = this._batch = fresh;
        }
      } else {
        if (canUseSimpleSyncFlush(this)) {
          commitPendingNodes();
          if (dirtyQueue._max >= dirtyQueue._min) {
            runHeap(dirtyQueue, GlobalQueue._update);
            commitPendingNodes();
          }
        } else {
          if (transitions.size) runHeap(zombieQueue, GlobalQueue._update);
          finalizePureQueue();
        }
      }
      clock++;
      // Check if finalization added items to the heap (from optimistic reversion)
      scheduled = dirtyQueue._max >= dirtyQueue._min;
      // Run lane effects first (for ready lanes), then regular effects
      activeLanes.size && GlobalQueue._runLaneEffects!(EFFECT_RENDER);
      this.run(EFFECT_RENDER);
      activeLanes.size && GlobalQueue._runLaneEffects!(EFFECT_USER);
      this.run(EFFECT_USER);
      if (__DEV__) {
        devCheckActiveOverrides(n => {
          if (this._batch._optimisticNodes.includes(n as OptimisticNode)) return true;
          if (activeTransition?._optimisticNodes.includes(n as OptimisticNode)) return true;
          for (const t of transitions)
            if (t._optimisticNodes.includes(n as OptimisticNode)) return true;
          return false;
        });
        devCensusCompanions(n => this._batch._pendingNodes.includes(n));
      }
      if (
        __DEV__ &&
        !scheduled &&
        !activeTransition &&
        transitions.size === 0 &&
        activeLanes.size === 0
      ) {
        // Fully drained: no transition-scoped state may survive this point.
        devCheckQuiescent(n => this._batch._pendingNodes.includes(n));
      }
      if (__DEV__) DEV.hooks.onUpdate?.();
    } finally {
      this._running = false;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    // Only track async if the boundary is propagating STATUS_PENDING (not caught by boundary)
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        const actualError = error !== undefined ? error : node._x?._error;
        // A visibility-only mark notification (the affects() boundary
        // channel) updates display state on its way up but must be invisible
        // to completion accounting BY CONSTRUCTION: it never registers a
        // reporter and never counts toward the loading-boundary diagnostic.
        if ((actualError as NotReadyError)?._markVisual) return true;
        if (activeTransition && actualError) {
          const source = (actualError as NotReadyError).source;
          // The one sanctioned registration site (INV-3): async blockers only
          // enter the transition from queue notification.
          if (__DEV__) beginAsyncReporterWrites();
          let reporters = activeTransition._asyncReporters.get(source);
          if (!reporters) activeTransition._asyncReporters.set(source, (reporters = new Set()));
          if (__DEV__) endAsyncReporterWrites();
          const prevSize = reporters.size;
          reporters.add(node);
          if (reporters.size !== prevSize) {
            schedule();
            GlobalQueue._wakeSuppressedProbes?.(activeTransition);
          }
        }
        if (__DEV__ && _enforceLoadingBoundary) _hitUnhandledAsync = true;
      }
      return true;
    }
    return false;
  }
  initTransition(transition?: Transition | null): void {
    if (transition) transition = currentTransition(transition);
    if (transition && transition === activeTransition) return;
    if (!transition && activeTransition && activeTransition._time === clock) return;
    if (!activeTransition) {
      activeTransition = transition ?? createBatch();
    } else if (transition) {
      const outgoing = activeTransition;
      mergeTransitionState(transition, outgoing);
      transitions.delete(outgoing);
      activeTransition = transition;
    }
    transitions.add(activeTransition);
    activeTransition._time = clock;
    const batch = this._batch;
    if (batch !== activeTransition) {
      // Adopt the ambient batch into the transaction, then make the
      // transaction the batch so later registrations land there directly.
      // Pending and optimistic nodes are re-stamped as the transaction's;
      // marks don't hijack the node's _transition — a mark on a plain signal
      // must not entangle unrelated writes to it; the same rule holds one hop
      // downstream: propagation never queues pended subscribers as pending
      // nodes, see propagateAffectsMark, #2893.
      for (let i = 0; i < batch._pendingNodes.length; i++) {
        const node = batch._pendingNodes[i];
        node._transition = activeTransition;
        activeTransition._pendingNodes.push(node);
      }
      for (let i = 0; i < batch._optimisticNodes.length; i++) {
        const node = batch._optimisticNodes[i];
        node._transition = activeTransition;
        activeTransition._optimisticNodes.push(node);
      }
      if (batch._affectsNodes.length) activeTransition._affectsNodes.push(...batch._affectsNodes);
      for (const store of batch._optimisticStores) activeTransition._optimisticStores.add(store);
      // Gated readers recorded against the ambient batch move with it: their
      // replay-at-commit now happens at the transaction's completion.
      if (batch._gatedSubs.size) {
        for (const sub of batch._gatedSubs) activeTransition._gatedSubs.add(sub);
        batch._gatedSubs.clear();
      }
      currentBatch = this._batch = activeTransition;
    }
    for (const lane of activeLanes) {
      if (!lane._transition) lane._transition = activeTransition;
    }
  }
}

export function queuePendingNode(node: Signal<any>): void {
  currentBatch._pendingNodes.push(node);
}

// Sticky: flips true on the first refresh() ever (the only setter of
// REACTIVE_REASK) so the hot notification loop skips the per-subscriber flag
// clear entirely in apps that never refresh.
export let reaskArmed = false;
/** §12d: bumped by every recompute and every new subscriber edge. A node's
 * staged-rewrite skip is sound only while NOTHING recomputed or linked since
 * its last notify — a mid-batch pull can clean a marked subscriber, and a
 * skipped re-write would leave it stale. */
export let notifyEpoch = 0;
export function bumpNotifyEpoch(): void {
  notifyEpoch++;
}
export function armReaskClear(): void {
  reaskArmed = true;
}

export function insertSubs(node: Signal<any> | Computed<any>, optimistic: boolean = false): void {
  // §12d: stamp before walking — setSignal's staged-rewrite fast path skips
  // the next walk for this node while the epoch holds (marking is idempotent).
  node._notifiedAt = notifyEpoch;
  // Get source lane: prefer node's own lane over current context
  // This is important for isPending signals which need their own lane to flush immediately
  // Presence bits gate the optional-slot probes (see constants.ts): one
  // masked read of the always-present _config instead of missing-property
  // lookups in the hottest notify loop. Bits are sticky — the field read
  // stays authoritative when a bit is set.
  const cfg = (node as any)._config as number;
  const sourceLane =
    (cfg & CONFIG_HAS_LANE ? (node as any)._x?._optimisticLane : undefined) ||
    currentOptimisticLane;

  const hasSnapshot =
    (cfg & CONFIG_HAS_SNAPSHOT) !== 0 && (node as any)._x?._snapshotValue !== undefined;
  const clearReask = reaskArmed;

  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    // A value-change notification is a new question for the subscriber: any
    // pending re-ask mark (refresh) it carried is superseded.
    if (clearReask) sub._flags &= ~REACTIVE_REASK;
    // Missed-wake latch (#3037): this write is landing while the subscriber
    // is mid-recompute (a nested pull committing beneath its reads), and the
    // heap refuses RECOMPUTING nodes. A gen-current link means the pass
    // already validated this dep — the value it read is now stale — so latch
    // for recompute's tail to reschedule. Untouched links need no latch (the
    // pass either re-reads them fresh or trims them), and neither does the
    // tail link: it is the read IN FLIGHT — read() links before it pulls, so
    // this very commit is what that read returns.
    if (sub._flags & REACTIVE_RECOMPUTING_DEPS && s._gen === sub._depGen && s !== sub._depsTail)
      sub._flags |= REACTIVE_MISSED_WAKE;
    if (hasSnapshot && sub._config & CONFIG_IN_SNAPSHOT_SCOPE) {
      sub._flags |= REACTIVE_SNAPSHOT_STALE;
      continue;
    }

    if (optimistic && sourceLane) {
      sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      assignOrMergeLane(sub as any, sourceLane);
    } else if (optimistic) {
      sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      // No source lane means reversion - clear subscriber's lane so effects go to regular queue
      if ((sub as any)._x) (sub as any)._x._optimisticLane = undefined;
    }

    enqueueSub(sub);
  }
}

function commitPendingNode(n: Signal<any>): void {
  const c = n as Partial<Computed<unknown>>;
  if (!c._fn) {
    if (n._pendingValue !== NOT_PENDING) {
      n._value = n._pendingValue as any;
      n._pendingValue = NOT_PENDING;
    }
    if (n._config & CONFIG_HAS_COMPANIONS) GlobalQueue._snapCompanions!(n);
    return;
  }
  if (n._pendingValue !== NOT_PENDING) {
    n._value = n._pendingValue as any;
    n._pendingValue = NOT_PENDING;
    // Set _modified for effects, but not for tracked effects (they handle their own scheduling)
    if ((n as any)._type && (n as any)._type !== EFFECT_TRACKED) (n as any)._modified = true;
  }
  // The committed hold is the first observable answer for a loading-window
  // node — the window closes here, not at compute time (#2990). Unconditional
  // store to an always-present computed slot.
  c._loading = false;
  c._flags! &= ~REACTIVE_MANUAL_WRITE;
  if (!(c._statusFlags! & STATUS_PENDING)) c._statusFlags! &= ~STATUS_UNINITIALIZED;
  if (c._x != null && (c._x._pendingFirstChild !== null || c._x._pendingDisposal !== null))
    GlobalQueue._dispose(c as Computed<unknown>, false, true);
  if (n._config & CONFIG_HAS_COMPANIONS) GlobalQueue._snapCompanions!(n);
}

// Store commit hook (INTERNALS-STORE-STATE.md §3): installed by the store
// module at init (same treeshakeable pattern as _resolveOptimistic /
// _clearOptimisticStores). Folds committed store-node values into their
// backing objects at the same moment pending values commit — the single
// mutation point of the owned-raw model.
export let storeCommitHook: (() => void) | null = null;
export function setStoreCommitHook(fn: () => void): void {
  storeCommitHook = fn;
}

/** Patch-channel release hook (next/patch.ts): transition-stamped patch
 * emissions are released when THEIR batch commits. Transitions never
 * abort: failed actions still commit (only optimistic overrides revert),
 * and merged-away transitions hand their stash to the survivor
 * (mergeTransitionState) — every stash drains exactly once. Injected like
 * storeCommitHook to stay tree-shakeable. */
export let patchCommitHook: ((batch: Transition) => void) | null = null;
export function setPatchCommitHook(fn: (batch: Transition) => void): void {
  patchCommitHook = fn;
}

function commitPendingNodes() {
  const pendingNodes = currentBatch._pendingNodes;
  for (let i = 0; i < pendingNodes.length; i++) {
    const node = pendingNodes[i];
    commitPendingNode(node);
    node._transition = null;
  }
  pendingNodes.length = 0;
  storeCommitHook?.();
  patchCommitHook?.(currentBatch);
}

export function finalizePureQueue(
  completingTransition: Transition | null = null,
  incomplete: boolean = false
) {
  // For incomplete transitions, skip pending resolution and optimistic reversion
  // For completing transitions or no-transition, resolve pending and revert optimistic
  const resolvePending = !incomplete;
  if (resolvePending) commitPendingNodes();
  if (!incomplete && globalQueue._children.length) checkBoundaryChildren(globalQueue);
  const ranHeap = dirtyQueue._max >= dirtyQueue._min;
  if (ranHeap) runHeap(dirtyQueue, GlobalQueue._update);
  if (resolvePending) {
    if (ranHeap) commitPendingNodes();
    // The settling batch: the completing transaction's, or the ambient one.
    const batch = completingTransition ?? globalQueue._batch;
    // Optimistic reversion: a non-empty batch means _optimisticWrite ran,
    // which installed the engine's hooks.
    if (batch._optimisticNodes.length) GlobalQueue._resolveOptimistic!(batch._optimisticNodes);
    // Replay entanglement: subs recorded by the read-time gate get rescheduled
    // so they re-run with the now-committed values visible. The ambient batch
    // replays too — laneReadsCommitted records readers whose committed-view
    // read hid a same-tick plain write that just committed above (#2963).
    if (batch._gatedSubs.size) {
      for (const sub of batch._gatedSubs) {
        if (sub._flags & REACTIVE_DISPOSED) continue;
        enqueueSub(sub);
      }
      batch._gatedSubs.clear();
      // A completing transition keeps the outer flush loop alive by itself;
      // the ambient batch needs the re-arm or the replay sits in the heap
      // until the next unrelated write.
      schedule();
    }
    // Declared motion ends with the transaction: settle (or plain flush end
    // for ambient marks) releases each registration's refcount. A non-empty
    // batch means registerAffectsMark ran, which installed the hook. Marks
    // held boundary display state through the visual channel, and their
    // release is the display-state update point — re-run the boundary sweep
    // (the earlier sweep above ran while the marks were still live).
    if (batch._affectsNodes.length) {
      GlobalQueue._releaseAffectsMarks!(batch._affectsNodes);
      if (globalQueue._children.length) checkBoundaryChildren(globalQueue);
    }
    // A non-empty set means trackOptimisticStore ran, which installed the
    // hook; the hook iterates, clears, and schedules (keeping the loop out of
    // core lets esbuild shake it — rollup already folds the null guard). The
    // completing transition scopes the clear to its own layer keys (#2899).
    if (batch._optimisticStores.size)
      GlobalQueue._clearOptimisticStores!(batch._optimisticStores, completingTransition);
    sweepTransientStoreNodes();
    // Lanes only enter activeLanes through the engine's getOrCreateLane.
    if (activeLanes.size) GlobalQueue._cleanupLanes!(completingTransition);
  }
}

function checkBoundaryChildren(queue: Queue) {
  for (const child of queue._children) {
    (child as any)._checkSources?.();
    checkBoundaryChildren(child as Queue);
  }
}

/**
 * Count of live `affects()` registrations across the system (including
 * store-scope inherited marks). Gates the read-path mark check in `read()` so
 * graphs that never use the feature pay one integer compare.
 */
export let activeAffectsMarks = 0;

/**
 * Counter mutation seam for the mark engine in affects.ts: an imported `let`
 * binding is read-only, and the read-path gate above must stay a plain module
 * variable so `read()` pays one integer compare, not a function call.
 *
 * @internal
 */
export function shiftAffectsMarks(delta: 1 | -1): void {
  activeAffectsMarks += delta;
}

function reassignPendingTransition(pendingNodes: Signal<any>[]) {
  for (let i = 0; i < pendingNodes.length; i++) {
    pendingNodes[i]._transition = activeTransition;
  }
}

export const globalQueue = new GlobalQueue();
// Hot-path mirror of `globalQueue._batch`: `queuePendingNode` runs once per
// staged write and `commitPendingNodes` once per flush, and the extra
// property hop through `_batch` was a measured instruction-count regression
// (CodSpeed update1to1, PR #2905). The field stays authoritative for
// cross-module readers; every `_batch` assignment updates both.
let currentBatch = globalQueue._batch;

/**
 * Synchronously processes the pending reactive queue, or runs `fn` in a synchronous
 * flush scope before draining the queue.
 *
 * Reactive updates are normally batched onto the microtask queue, so multiple
 * writes in a row collapse into a single update pass. Call `flush()` when you
 * need to *observe* the result of those writes synchronously — most commonly
 * in tests, but also at the boundary of imperative integration code. Pass a
 * callback when the writes themselves should bypass microtask scheduling and
 * drain synchronously when the callback returns.
 *
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 * const doubled = createMemo(() => count() * 2);
 *
 * setCount(5);
 * flush();
 * expect(doubled()).toBe(10);
 *
 * flush(() => setCount(6));
 * expect(doubled()).toBe(12);
 *
 * // Nested flushes drain at each level:
 * flush(() => {
 *   setCount(7);
 *   flush(() => setCount(8)); // inner drain — effects fire here
 *   // outer continues with up-to-date state
 * });
 * ```
 */
export function flush(): void;
export function flush<T>(fn: () => T): T;
export function flush<T>(fn?: () => T): T | void {
  if (fn) {
    syncDepth++;
    try {
      return fn();
    } finally {
      // Decrement even if the drain throws (a throwing effect): a leaked
      // syncDepth would stop `schedule()` from ever queuing a microtask again.
      try {
        flush();
      } finally {
        syncDepth--;
      }
    }
  }
  if (globalQueue._running) {
    if (__DEV__ && inTrackedQueueCallback) {
      throw new Error(
        "Cannot call flush() from inside onSettled or createTrackedEffect. flush() is not reentrant there. " +
          "Writes made here are processed in the same flush's continuation; to force a drain afterwards, defer it: queueMicrotask(() => flush())."
      );
    }
    if (__DEV__ && inEffectCallback) {
      const message =
        "[FLUSH_IN_EFFECT_CALLBACK] flush() called from inside an effect callback is a no-op: the flush that runs effects is already in progress. " +
        "Writes made here are processed in the same flush's continuation; to force a drain afterwards, defer it: queueMicrotask(() => flush()).";
      emitDiagnostic({
        code: "FLUSH_IN_EFFECT_CALLBACK",
        kind: "lifecycle",
        severity: "warn",
        message
      });
      console.warn(message);
    }
    return;
  }
  if (halted) return;
  let count = 0;
  // `flush()` is an explicit drain point, so it must also process an active
  // transition even if no microtask was scheduled for it yet.
  while (scheduled || activeTransition) {
    if (__DEV__ && ++count === 1e5) throw new Error("Potential Infinite Loop Detected.");
    globalQueue.flush();
  }
}

function runQueue(queue: QueueCallback[], type: number): void {
  for (let i = 0; i < queue.length; i++) queue[i](type);
}

function reporterBlocksSource(reporter: Computed<any>, source: Computed<any>): boolean {
  if (reporter._flags & (REACTIVE_ZOMBIE | REACTIVE_DISPOSED)) return false;
  if (reporter._x?._pendingSources?.has(source)) return true;
  for (let dep = reporter._deps; dep; dep = dep._nextDep) {
    let current = dep._dep as Signal<any> | Computed<any> | undefined;
    while (current) {
      if (current === source || (current as any)._firewall === source) return true;
      current = current._x?._parentSource;
    }
  }
  return !!(
    reporter._statusFlags & STATUS_PENDING &&
    reporter._x?._error instanceof NotReadyError &&
    reporter._x?._error.source === source
  );
}

function transitionComplete(transition: Transition): boolean {
  if (transition._done) return true;
  if (transition._actions.length) return false;
  let done = true;
  for (const [source, reporters] of transition._asyncReporters) {
    let hasLive = false;
    for (const reporter of reporters) {
      if (reporterBlocksSource(reporter, source)) {
        hasLive = true;
        break;
      }
      reporters.delete(reporter);
    }
    if (!hasLive) transition._asyncReporters.delete(source);
    else if (
      source._statusFlags & STATUS_PENDING &&
      (source._x?._error as NotReadyError)?.source === source
    ) {
      done = false;
      break;
    }
  }
  // Override blockage lives with the engine (absent hook = "no optimistic
  // blockage"); the hook's loops over _optimisticNodes/_optimisticStores are
  // no-ops when the transition holds neither, so no pre-check is needed.
  if (done && GlobalQueue._transitionBlocked?.(transition)) done = false;
  done && (transition._done = true);
  return done;
}
export function currentTransition(transition: Transition) {
  while (transition._done && typeof transition._done === "object") transition = transition._done;
  return transition;
}

export function setActiveTransition(transition: Transition | null) {
  activeTransition = transition;
}

export function runInTransition<T>(transition: Transition, fn: () => T): T {
  const prevTransition = activeTransition;

  try {
    activeTransition = currentTransition(transition);
    return fn();
  } finally {
    activeTransition = prevTransition;
  }
}
