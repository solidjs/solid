import {
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_ZOMBIE,
  STATUS_PENDING
} from "./constants.js";
import type { Computed, Signal } from "./core.js";
import type { NotReadyError } from "./error.js";
import { insertIntoHeap, runHeap, type Heap } from "./heap.js";

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

// ============================================================================
// Per-Override Optimistic Lane Architecture
// ============================================================================

/**
 * OptimisticLane represents the context for a single optimistic write.
 * Each optimistic signal creates its own lane. Lanes merge when their
 * dependency graphs overlap.
 */
export interface OptimisticLane {
  _source: Signal<any>; // The optimistic signal that created this lane
  _pendingAsync: Set<Computed<any>>; // Async nodes triggered by this lane
  _effectQueues: [QueueCallback[], QueueCallback[]]; // [render, user] effects for this lane
  _mergedInto: OptimisticLane | null; // Union-find: points to merged lane, or null if root
  _transition: Transition | null; // Which transition owns this lane (null = orphan)
}

// Map from optimistic signal to its lane (reused for multiple writes to same signal)
const signalLanes = new WeakMap<Signal<any>, OptimisticLane>();

// All active lanes (for cleanup on transition completion)
export const activeLanes = new Set<OptimisticLane>();

// Current lane context during recomputation
export let currentOptimisticLane: OptimisticLane | null = null;

export function setCurrentOptimisticLane(lane: OptimisticLane | null): void {
  currentOptimisticLane = lane;
}

/**
 * Get an existing lane for a signal or create a new one.
 * Reuses lane for multiple writes to the same signal.
 */
export function getOrCreateLane(signal: Signal<any>): OptimisticLane {
  let lane = signalLanes.get(signal);
  if (lane) {
    // Return the root lane (follow mergedInto chain)
    return findLane(lane);
  }

  // Create new lane
  lane = {
    _source: signal,
    _pendingAsync: new Set(),
    _effectQueues: [[], []],
    _mergedInto: null,
    _transition: activeTransition
  };
  signalLanes.set(signal, lane);
  activeLanes.add(lane);
  // Snapshot override version at lane creation for correction gating
  (signal as any)._laneVersion = (signal as any)._overrideVersion || 0;
  return lane;
}

/**
 * Union-find: find the root lane.
 */
export function findLane(lane: OptimisticLane): OptimisticLane {
  while (lane._mergedInto) lane = lane._mergedInto;
  return lane;
}

/**
 * Merge two lanes when their dependency graphs overlap.
 */
export function mergeLanes(lane1: OptimisticLane, lane2: OptimisticLane): OptimisticLane {
  lane1 = findLane(lane1);
  lane2 = findLane(lane2);
  if (lane1 === lane2) return lane1;

  lane2._mergedInto = lane1;
  for (const node of lane2._pendingAsync) lane1._pendingAsync.add(node);
  lane1._effectQueues[0].push(...lane2._effectQueues[0]);
  lane1._effectQueues[1].push(...lane2._effectQueues[1]);

  return lane1;
}

/**
 * Clear a signal's lane entry so the next getOrCreateLane creates a fresh lane.
 * Used after merging a sub-lane (e.g., _pendingSignal) into a parent lane.
 */
export function clearLaneEntry(signal: Signal<any>): void {
  signalLanes.delete(signal);
}

/**
 * Resolve a node's lane: follow union-find chain, verify active, clear if stale.
 */
export function resolveLane(el: { _optimisticLane?: OptimisticLane }): OptimisticLane | undefined {
  const lane = el._optimisticLane;
  if (!lane) return undefined;
  const root = findLane(lane);
  if (activeLanes.has(root)) return root;
  el._optimisticLane = undefined;
  return undefined;
}

/**
 * Check if a node has an active optimistic override (pending value differs from base).
 */
export function hasActiveOverride(el: { _optimistic?: boolean; _pendingValue?: any }): boolean {
  return !!(el._optimistic && el._pendingValue !== NOT_PENDING);
}

/**
 * Assign or merge a lane onto a node. At convergence points (node already has
 * a different active lane), merge unless the node has an active override.
 */
export function assignOrMergeLane(
  el: { _optimisticLane?: OptimisticLane; _optimistic?: boolean; _pendingValue?: any },
  sourceLane: OptimisticLane
): void {
  const sourceRoot = findLane(sourceLane);
  const existing = el._optimisticLane;
  if (existing) {
    // If the subscriber's lane was merged into another lane, it's stale —
    // replace it with the new source lane instead of following the merge chain
    // (which would incorrectly merge the new lane into the old group)
    if (existing._mergedInto) {
      el._optimisticLane = sourceLane;
      return;
    }
    const existingRoot = findLane(existing);
    if (activeLanes.has(existingRoot)) {
      if (existingRoot !== sourceRoot && !hasActiveOverride(el)) {
        mergeLanes(sourceRoot, existingRoot);
      }
      return;
    }
  }
  el._optimisticLane = sourceLane;
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

export function setProjectionWriteActive(value: boolean) {
  projectionWriteActive = value;
}

export type QueueCallback = (type: number) => void;
type QueueStub = {
  _queues: [QueueCallback[], QueueCallback[]];
  _children: QueueStub[];
};
export interface Transition {
  _time: number;
  _asyncNodes: Computed<any>[];
  _pendingNodes: Signal<any>[];
  _optimisticNodes: Signal<any>[]; // Signals with optimistic overrides (for value reversion)
  _optimisticStores: Set<any>;
  _actions: Array<Generator<any, any, any> | AsyncGenerator<any, any, any>>;
  _queueStash: QueueStub;
  _done: boolean | Transition;
}

export function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!globalQueue._running) queueMicrotask(flush);
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
  private _runQueue(type: number) {
    if (this._queues[type - 1].length) {
      const effects = this._queues[type - 1];
      this._queues[type - 1] = [];
      runQueue(effects, type);
    }
    for (let i = 0; i < this._children.length; i++) {
      (this._children[i] as any).run?.(type);
    }
  }
  run(type: number) {
    this._runQueue(type);
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
  _optimisticNodes: Signal<any>[] = [];
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
          let t = activeTransition;
          runHeap(zombieQueue, GlobalQueue._update);
          this._pendingNodes = [];
          this._optimisticNodes = [];
          this._optimisticStores = new Set();

          // Run lane effects immediately (before stashing) - lanes with no pending async
          runLaneEffects(EFFECT_RENDER);
          runLaneEffects(EFFECT_USER);

          this.stashQueues(activeTransition!._queueStash);
          clock++;
          scheduled = dirtyQueue._max >= dirtyQueue._min;
          reassignPendingTransition(activeTransition!._pendingNodes);
          activeTransition = null;
          finalizePureQueue(null, true);
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
        // Use passed error if provided (for blocked notifications), otherwise node's own
        const actualError = error !== undefined ? error : node._error;
        if (
          activeTransition &&
          actualError &&
          !activeTransition._asyncNodes.includes((actualError as NotReadyError)._source)
        ) {
          activeTransition._asyncNodes.push((actualError as NotReadyError)._source);
          schedule();
        }
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
      // Entangle: merge activeTransition into the target transition
      const outgoing = activeTransition;
      outgoing._done = transition;
      transition._actions.push(...outgoing._actions);
      // Reassign lane ownership from outgoing to target
      for (const lane of activeLanes) {
        if (lane._transition === outgoing) lane._transition = transition;
      }
      // Transfer optimistic nodes from outgoing
      transition._optimisticNodes.push(...outgoing._optimisticNodes);
      // Transfer optimistic stores from outgoing
      for (const store of outgoing._optimisticStores) {
        transition._optimisticStores.add(store);
      }
      transitions.delete(outgoing);
      activeTransition = transition;
    }
    transitions.add(activeTransition);
    activeTransition._time = clock;
    for (let i = 0; i < this._pendingNodes.length; i++) {
      const n = this._pendingNodes[i];
      n._transition = activeTransition;
      activeTransition._pendingNodes.push(n);
    }
    this._pendingNodes = activeTransition._pendingNodes;
    // Share reference - optimistic writes go directly to the transition's array
    for (let i = 0; i < this._optimisticNodes.length; i++) {
      const node = this._optimisticNodes[i];
      node._transition = activeTransition; // Mark ownership
      activeTransition._optimisticNodes.push(node);
    }
    this._optimisticNodes = activeTransition._optimisticNodes;
    // Assign orphan lanes to this transition
    for (const lane of activeLanes) {
      if (!lane._transition) lane._transition = activeTransition;
    }
    // Move optimistic stores to transition
    for (const store of this._optimisticStores) {
      activeTransition._optimisticStores.add(store);
    }
    this._optimisticStores = activeTransition._optimisticStores;
  }
}

export function insertSubs(node: Signal<any> | Computed<any>, optimistic: boolean = false): void {
  // Get source lane: prefer node's own lane over current context
  // This is important for isPending signals which need their own lane to flush immediately
  const sourceLane = (node as any)._optimisticLane || currentOptimisticLane;
  
  for (let s = node._subs; s !== null; s = s._nextSub) {
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

export function finalizePureQueue(
  completingTransition: Transition | null = null,
  incomplete: boolean = false
) {
  // For incomplete transitions, skip pending resolution and optimistic reversion
  // For completing transitions or no-transition, resolve pending and revert optimistic
  let resolvePending = !incomplete;
  if (!incomplete) checkBoundaryChildren(globalQueue);
  if (dirtyQueue._max >= dirtyQueue._min) {
    runHeap(dirtyQueue, GlobalQueue._update);
  }
  if (resolvePending) {
    // Commit pending nodes
    const pendingNodes = globalQueue._pendingNodes;
    for (let i = 0; i < pendingNodes.length; i++) {
      const n = pendingNodes[i];
      if (n._pendingValue !== NOT_PENDING) {
        n._value = n._pendingValue as any;
        n._pendingValue = NOT_PENDING;
        // Set _modified for effects, but not for tracked effects (they handle their own scheduling)
        if ((n as any)._type && (n as any)._type !== EFFECT_TRACKED) (n as any)._modified = true;
      }
      if ((n as Computed<unknown>)._fn) GlobalQueue._dispose(n as Computed<unknown>, false, true);
    }
    pendingNodes.length = 0;

    // Revert optimistic nodes from the completing transition or orphan list
    const optimisticNodes = completingTransition
      ? completingTransition._optimisticNodes
      : globalQueue._optimisticNodes;
    for (let i = 0; i < optimisticNodes.length; i++) {
      const n = optimisticNodes[i];
      const original = n._pendingValue;
      // Clear lane association before reversion so effects go to regular queue
      n._optimisticLane = undefined;
      // Revert to the saved value
      if (original !== NOT_PENDING && n._value !== original) {
        n._value = original as any;
        // Use optimistic=true for immediate effect execution, but lane is cleared
        // so effects will go to regular queue (no currentOptimisticLane)
        insertSubs(n, true);
      }
      n._pendingValue = NOT_PENDING;
      n._transition = null; // Clear ownership
    }
    optimisticNodes.length = 0;

    // Clear optimistic stores
    const optimisticStores = completingTransition
      ? completingTransition._optimisticStores
      : globalQueue._optimisticStores;
    if (GlobalQueue._clearOptimisticStore && optimisticStores.size) {
      for (const store of optimisticStores) {
        GlobalQueue._clearOptimisticStore(store);
      }
      optimisticStores.clear();
      // Schedule another flush to process any dirty computeds (like projections)
      schedule();
    }

    // Run lane effects and clean up lanes owned by the completing transition (or orphans)
    for (const lane of activeLanes) {
      const owned = completingTransition
        ? lane._transition === completingTransition
        : !lane._transition;
      if (!owned) continue;
      if (!lane._mergedInto) {
        // Run render effects first, then user effects
        if (lane._effectQueues[0].length) runQueue(lane._effectQueues[0], EFFECT_RENDER);
        if (lane._effectQueues[1].length) runQueue(lane._effectQueues[1], EFFECT_USER);
      }
      // Clear lane
      if (lane._source._optimisticLane === lane) lane._source._optimisticLane = undefined;
      lane._pendingAsync.clear();
      lane._effectQueues[0].length = 0;
      lane._effectQueues[1].length = 0;
      activeLanes.delete(lane);
      signalLanes.delete(lane._source);
    }
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
  while (scheduled) {
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
    if (transition._asyncNodes[i]._statusFlags & STATUS_PENDING) {
      done = false;
      break;
    }
  }
  done && (transition._done = true);
  return done;
}
function currentTransition(transition: Transition) {
  while (transition._done && typeof transition._done === "object") transition = transition._done;
  return transition;
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

function restoreTransition<T>(transition: Transition, fn: () => T): T {
  globalQueue.initTransition(transition);
  const result = fn();
  flush();
  return result;
}

export function action<Args extends any[], Y, R>(
  genFn: (...args: Args) => Generator<Y, R, any> | AsyncGenerator<Y, R, any>
) {
  return (...args: Args): Promise<R> =>
    new Promise((resolve, reject) => {
      const it = genFn(...args);
      globalQueue.initTransition();
      let ctx = activeTransition!;
      ctx._actions.push(it);

      const done = (v?: R, e?: any) => {
        ctx = currentTransition(ctx);
        const i = ctx._actions.indexOf(it);
        if (i >= 0) ctx._actions.splice(i, 1);
        activeTransition = ctx;
        schedule();
        e ? reject(e) : resolve(v!);
      };

      const step = (v?: any, err?: boolean): void => {
        let r: IteratorResult<Y, R> | Promise<IteratorResult<Y, R>>;
        try {
          r = err ? it.throw!(v) : it.next(v);
        } catch (e) {
          return done(undefined, e);
        }
        if (r instanceof Promise)
          return void r.then(run, e => restoreTransition(ctx, () => step(e, true)));
        run(r);
      };

      const run = (r: IteratorResult<Y, R>) => {
        if (r.done) return done(r.value);
        if (r.value instanceof Promise)
          return void r.value.then(
            v => restoreTransition(ctx, () => step(v)),
            e => restoreTransition(ctx, () => step(e, true))
          );
        restoreTransition(ctx, () => step(r.value));
      };

      step();
    });
}
