import {
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { currentOptimisticLane } from "./core.js";
import { NotReadyError } from "./error.js";
import { insertIntoHeap, runHeap, type Heap } from "./heap.js";
import {
  activeLanes,
  assignOrMergeLane,
  findLane,
  hasActiveOverride,
  signalLanes,
} from "./lanes.js";
import type { Computed, Signal } from "./types.js";

export { activeLanes, assignOrMergeLane, findLane };
export {
  getOrCreateLane,
  hasActiveOverride,
  mergeLanes,
  resolveLane
} from "./lanes.js";

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

export let clock = 0;
export let activeTransition: Transition | null = null;
let scheduled = false;
export let projectionWriteActive = false;

let _enforceLoadingBoundary = false;
export let _hitUnhandledAsync = false;
// When a background transition is stashed, plain optimistic signals need one
// committed-view rerun. Keep that override local to the stash flush.
let stashedOptimisticReads: Set<Signal<any>> | null = null;
export function resetUnhandledAsync(): void {
  _hitUnhandledAsync = false;
}
export function enforceLoadingBoundary(enabled: boolean): void {
  _enforceLoadingBoundary = enabled;
}

export function shouldReadStashedOptimisticValue(node: Signal<any>): boolean {
  return !!stashedOptimisticReads?.has(node);
}

/**
 * Run effects from all lanes that are ready (no pending async).
 */
function runLaneEffects(type: number): void {
  for (const lane of activeLanes) {
    if (lane._mergedInto || lane._pendingAsync.size > 0) continue;
    const effects = lane._effectQueues[type - 1];
    if (effects.length) {
      lane._effectQueues[type - 1] = [];
      runQueue(effects, type);
    }
  }
}

function queueStashedOptimisticEffects(node: Signal<any>): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub as any;
    if (!sub._type) continue;
    if (sub._type === EFFECT_TRACKED) {
      if (!sub._modified) {
        sub._modified = true;
        sub._queue.enqueue(EFFECT_USER, sub._run);
      }
      continue;
    }
    const queue = sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
    if (queue._min > sub._height) queue._min = sub._height;
    insertIntoHeap(sub, queue);
  }
}

export function setProjectionWriteActive(value: boolean) {
  projectionWriteActive = value;
}

export type QueueCallback = (type: number) => void;
type QueueStub = {
  _queues: [QueueCallback[], QueueCallback[]];
  _children: QueueStub[];
};
type OptimisticNode = Signal<any> | Computed<any>;
export interface Transition {
  _time: number;
  _asyncNodes: Computed<any>[];
  _pendingNodes: Signal<any>[];
  _optimisticNodes: OptimisticNode[]; // Optimistic signals/computeds pending transition reversion
  _optimisticStores: Set<any>;
  _actions: Array<Generator<any, any, any> | AsyncGenerator<any, any, any>>;
  _queueStash: QueueStub;
  _done: boolean | Transition;
}

function mergeTransitionState(target: Transition, outgoing: Transition): void {
  outgoing._done = target;
  target._actions.push(...outgoing._actions);
  for (const lane of activeLanes) {
    if (lane._transition === outgoing) lane._transition = target;
  }
  target._optimisticNodes.push(...outgoing._optimisticNodes);
  for (const store of outgoing._optimisticStores) target._optimisticStores.add(store);
  for (const node of outgoing._asyncNodes) {
    if (!target._asyncNodes.includes(node)) target._asyncNodes.push(node);
  }
}

function resolveOptimisticNodes(nodes: OptimisticNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node._optimisticLane = undefined;
    if (node._pendingValue !== NOT_PENDING) {
      node._value = node._pendingValue as any;
      node._pendingValue = NOT_PENDING;
    }
    const prevOverride = node._overrideValue;
    node._overrideValue = NOT_PENDING;
    if (prevOverride !== NOT_PENDING && node._value !== prevOverride) insertSubs(node, true);
    node._transition = null;
  }
  nodes.length = 0;
}

function cleanupCompletedLanes(completingTransition: Transition | null): void {
  for (const lane of activeLanes) {
    const owned = completingTransition
      ? lane._transition === completingTransition
      : !lane._transition;
    if (!owned) continue;
    if (!lane._mergedInto) {
      if (lane._effectQueues[0].length) runQueue(lane._effectQueues[0], EFFECT_RENDER);
      if (lane._effectQueues[1].length) runQueue(lane._effectQueues[1], EFFECT_USER);
    }
    if (lane._source._optimisticLane === lane) lane._source._optimisticLane = undefined;
    lane._pendingAsync.clear();
    lane._effectQueues[0].length = 0;
    lane._effectQueues[1].length = 0;
    activeLanes.delete(lane);
    signalLanes.delete(lane._source);
  }
}

export function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!globalQueue._running && !projectionWriteActive) queueMicrotask(flush);
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

export class Queue implements IQueue {
  _parent: IQueue | null = null;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _children: IQueue[] = [];
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
    for (let i = 0; i < this._children.length; i++) (this._children[i] as any).run?.(type);
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
  _pendingNodes: Signal<any>[] = [];
  _optimisticNodes: OptimisticNode[] = [];
  _optimisticStores: Set<any> = new Set();
  static _update: (el: Computed<unknown>) => void;
  static _dispose: (el: Computed<unknown>, self: boolean, zombie: boolean) => void;
  static _clearOptimisticStore: ((store: any) => void) | null = null;
  flush() {
    if (this._running) return;
    this._running = true;
    try {
      runHeap(dirtyQueue, GlobalQueue._update);
      if (activeTransition) {
        const isComplete = transitionComplete(activeTransition);
        if (!isComplete) {
          const stashedTransition = activeTransition!;
          runHeap(zombieQueue, GlobalQueue._update);
          this._pendingNodes = [];
          this._optimisticNodes = [];
          this._optimisticStores = new Set();

          // Run lane effects immediately (before stashing) - lanes with no pending async
          runLaneEffects(EFFECT_RENDER);
          runLaneEffects(EFFECT_USER);

          this.stashQueues(stashedTransition._queueStash);
          clock++;
          scheduled = dirtyQueue._max >= dirtyQueue._min;
          reassignPendingTransition(stashedTransition._pendingNodes);
          activeTransition = null;
          if (!stashedTransition._actions.length && stashedTransition._optimisticNodes.length) {
            stashedOptimisticReads = new Set();
            for (let i = 0; i < stashedTransition._optimisticNodes.length; i++) {
              const node = stashedTransition._optimisticNodes[i];
              if ((node as any)._fn || node._pureWrite) continue;
              stashedOptimisticReads.add(node);
              queueStashedOptimisticEffects(node);
            }
          }
          try {
            finalizePureQueue(null, true);
          } finally {
            stashedOptimisticReads = null;
          }
          return;
        }
        this._pendingNodes !== activeTransition._pendingNodes &&
          this._pendingNodes.push(...activeTransition._pendingNodes);
        this.restoreQueues(activeTransition._queueStash);
        transitions.delete(activeTransition);
        const completingTransition = activeTransition;
        activeTransition = null;
        reassignPendingTransition(this._pendingNodes);
        finalizePureQueue(completingTransition);
      } else {
        if (transitions.size) runHeap(zombieQueue, GlobalQueue._update);
        finalizePureQueue();
      }
      clock++;
      // Check if finalization added items to the heap (from optimistic reversion)
      scheduled = dirtyQueue._max >= dirtyQueue._min;
      // Run lane effects first (for ready lanes), then regular effects
      runLaneEffects(EFFECT_RENDER);
      this.run(EFFECT_RENDER);
      runLaneEffects(EFFECT_USER);
      this.run(EFFECT_USER);
    } finally {
      this._running = false;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    // Only track async if the boundary is propagating STATUS_PENDING (not caught by boundary)
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        const actualError = error !== undefined ? error : node._error;
        if (activeTransition && actualError) {
          const source = (actualError as NotReadyError).source;
          if (!activeTransition._asyncNodes.includes(source)) {
            activeTransition._asyncNodes.push(source);
            schedule();
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
      activeTransition = transition ?? {
        _time: clock,
        _pendingNodes: [],
        _asyncNodes: [],
        _optimisticNodes: [],
        _optimisticStores: new Set(),
        _actions: [],
        _queueStash: { _queues: [[], []], _children: [] },
        _done: false
      };
    } else if (transition) {
      const outgoing = activeTransition;
      mergeTransitionState(transition, outgoing);
      transitions.delete(outgoing);
      activeTransition = transition;
    }
    transitions.add(activeTransition);
    activeTransition._time = clock;
    if (this._pendingNodes !== activeTransition._pendingNodes) {
      for (let i = 0; i < this._pendingNodes.length; i++) {
        const node = this._pendingNodes[i];
        node._transition = activeTransition;
        activeTransition._pendingNodes.push(node);
      }
      this._pendingNodes = activeTransition._pendingNodes;
    }
    if (this._optimisticNodes !== activeTransition._optimisticNodes) {
      for (let i = 0; i < this._optimisticNodes.length; i++) {
        const node = this._optimisticNodes[i];
        node._transition = activeTransition;
        activeTransition._optimisticNodes.push(node);
      }
      this._optimisticNodes = activeTransition._optimisticNodes;
    }
    for (const lane of activeLanes) {
      if (!lane._transition) lane._transition = activeTransition;
    }
    if (this._optimisticStores !== activeTransition._optimisticStores) {
      for (const store of this._optimisticStores) activeTransition._optimisticStores.add(store);
      this._optimisticStores = activeTransition._optimisticStores;
    }
  }
}

export function insertSubs(node: Signal<any> | Computed<any>, optimistic: boolean = false): void {
  // Get source lane: prefer node's own lane over current context
  // This is important for isPending signals which need their own lane to flush immediately
  const sourceLane = (node as any)._optimisticLane || currentOptimisticLane;

  const hasSnapshot = (node as any)._snapshotValue !== undefined;

  for (let s = node._subs; s !== null; s = s._nextSub) {
    if (hasSnapshot && (s._sub as any)._inSnapshotScope) {
      s._sub._flags |= REACTIVE_SNAPSHOT_STALE;
      continue;
    }

    if (optimistic && sourceLane) {
      s._sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      assignOrMergeLane(s._sub as any, sourceLane);
    } else if (optimistic) {
      s._sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      // No source lane means reversion - clear subscriber's lane so effects go to regular queue
      (s._sub as any)._optimisticLane = undefined;
    }

    // Tracked effects bypass heap, go directly to effect queue
    const sub = s._sub as any;
    if (sub._type === EFFECT_TRACKED) {
      if (!sub._modified) {
        sub._modified = true;
        sub._queue.enqueue(EFFECT_USER, sub._run);
      }
      continue;
    }

    const queue = s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
    if (queue._min > s._sub._height) queue._min = s._sub._height;
    insertIntoHeap(s._sub, queue);
  }
}

function commitPendingNodes() {
  const pendingNodes = globalQueue._pendingNodes;
  for (let i = 0; i < pendingNodes.length; i++) {
    const n = pendingNodes[i];
    if (n._pendingValue !== NOT_PENDING) {
      n._value = n._pendingValue as any;
      n._pendingValue = NOT_PENDING;
      // Set _modified for effects, but not for tracked effects (they handle their own scheduling)
      if ((n as any)._type && (n as any)._type !== EFFECT_TRACKED) (n as any)._modified = true;
    }
    if (!((n as Computed<unknown>)._statusFlags & STATUS_PENDING))
      (n as Computed<unknown>)._statusFlags &= ~STATUS_UNINITIALIZED;
    if ((n as Computed<unknown>)._fn) GlobalQueue._dispose(n as Computed<unknown>, false, true);
  }
  pendingNodes.length = 0;
}

export function finalizePureQueue(
  completingTransition: Transition | null = null,
  incomplete: boolean = false
) {
  // For incomplete transitions, skip pending resolution and optimistic reversion
  // For completing transitions or no-transition, resolve pending and revert optimistic
  const resolvePending = !incomplete;
  if (resolvePending) commitPendingNodes();
  if (!incomplete) checkBoundaryChildren(globalQueue);
  if (dirtyQueue._max >= dirtyQueue._min) runHeap(dirtyQueue, GlobalQueue._update);
  if (resolvePending) {
    commitPendingNodes();
    resolveOptimisticNodes(
      completingTransition ? completingTransition._optimisticNodes : globalQueue._optimisticNodes
    );
    const optimisticStores = completingTransition
      ? completingTransition._optimisticStores
      : globalQueue._optimisticStores;
    if (GlobalQueue._clearOptimisticStore && optimisticStores.size) {
      for (const store of optimisticStores) {
        GlobalQueue._clearOptimisticStore(store);
      }
      optimisticStores.clear();
      schedule();
    }
    cleanupCompletedLanes(completingTransition);
  }
}

function checkBoundaryChildren(queue: Queue) {
  for (const child of queue._children) {
    (child as any).checkSources?.();
    checkBoundaryChildren(child as Queue);
  }
}

export function trackOptimisticStore(store: any): void {
  // After initTransition, globalQueue._optimisticStores IS activeTransition._optimisticStores (same reference)
  globalQueue._optimisticStores.add(store);
  schedule();
}

function reassignPendingTransition(pendingNodes: Signal<any>[]) {
  for (let i = 0; i < pendingNodes.length; i++) {
    pendingNodes[i]._transition = activeTransition;
  }
}

export const globalQueue = new GlobalQueue();

/**
 * By default, changes are batched on the microtask queue which is an async process. You can flush
 * the queue synchronously to get the latest updates by calling `flush()`.
 */
export function flush(): void {
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

function transitionComplete(transition: Transition): boolean {
  if (transition._done) return true;
  if (transition._actions.length) return false;
  let done = true;
  for (let i = 0; i < transition._asyncNodes.length; i++) {
    const node = transition._asyncNodes[i];
    if (node._statusFlags & STATUS_PENDING && (node._error as NotReadyError)?.source === node) {
      done = false;
      break;
    }
  }
  if (done) {
    for (let i = 0; i < transition._optimisticNodes.length; i++) {
      const node = transition._optimisticNodes[i];
      if (
        hasActiveOverride(node) &&
        "_statusFlags" in node &&
        node._statusFlags & STATUS_PENDING &&
        node._error instanceof NotReadyError &&
        node._error.source !== node
      ) {
        done = false;
        break;
      }
    }
  }
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
