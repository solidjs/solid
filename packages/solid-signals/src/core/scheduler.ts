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
export let optimisticReadActive = false;
export let projectionWriteActive = false;

export function setOptimisticReadActive(value: boolean) {
  optimisticReadActive = value;
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
  time: number;
  asyncNodes: Computed<any>[];
  pendingNodes: Signal<any>[];
  optimisticNodes: Signal<any>[];
  optimisticStores: Set<any>;
  actions: Array<Generator<any, any, any> | AsyncGenerator<any, any, any>>;
  queueStash: QueueStub;
  done: boolean | Transition;
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
  notify(node: Computed<any>, mask: number, flags: number): boolean;
  stashQueues(stub: QueueStub): void;
  restoreQueues(stub: QueueStub): void;
  _parent: IQueue | null;
}

export class Queue implements IQueue {
  _parent: IQueue | null = null;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _optimisticQueues: [QueueCallback[], QueueCallback[]] = [[], []];
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
  notify(node: Computed<any>, mask: number, flags: number): boolean {
    if (this._parent) return this._parent.notify(node, mask, flags);
    return false;
  }
  private _runQueue(type: number, queues: QueueCallback[][], method: "run" | "runOptimistic") {
    if (queues[type - 1].length) {
      const effects = queues[type - 1];
      queues[type - 1] = [];
      runQueue(effects, type);
    }
    for (let i = 0; i < this._children.length; i++) {
      (this._children[i] as any)[method]?.(type);
    }
  }
  run(type: number) {
    this._runQueue(type, this._queues, "run");
  }
  runOptimistic(type: number) {
    this._runQueue(type, this._optimisticQueues, "runOptimistic");
  }
  enqueue(type: number, fn: QueueCallback): void {
    if (type) {
      // Route to optimistic queue if we're in an optimistic recomputation
      const queue = optimisticReadActive ? this._optimisticQueues : this._queues;
      queue[type - 1].push(fn);
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

          // Run optimistic effects immediately (before stashing)
          this.runOptimistic(EFFECT_RENDER);
          this.runOptimistic(EFFECT_USER);

          this.stashQueues(activeTransition!.queueStash);
          clock++;
          scheduled = false;
          runTransitionPending(activeTransition!.pendingNodes);
          activeTransition = null;
          finalizePureQueue(null, true);
          return;
        }
        this._pendingNodes !== activeTransition.pendingNodes &&
          this._pendingNodes.push(...activeTransition.pendingNodes);
        this.restoreQueues(activeTransition.queueStash);
        transitions.delete(activeTransition);
        const completingTransition = activeTransition;
        activeTransition = null;
        runTransitionPending(this._pendingNodes);
        finalizePureQueue(completingTransition);
      } else {
        if (transitions.size) runHeap(zombieQueue, GlobalQueue._update);
        finalizePureQueue();
      }
      clock++;
      // Check if finalization added items to the heap (from optimistic reversion)
      scheduled = dirtyQueue._max >= dirtyQueue._min;
      // Run both optimistic and regular effects
      this.runOptimistic(EFFECT_RENDER);
      this.run(EFFECT_RENDER);
      this.runOptimistic(EFFECT_USER);
      this.run(EFFECT_USER);
    } finally {
      this._running = false;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number): boolean {
    // Only track async if the boundary is propagating STATUS_PENDING (not caught by boundary)
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        if (
          activeTransition &&
          node._error &&
          !activeTransition.asyncNodes.includes((node._error as NotReadyError)._source)
        ) {
          activeTransition.asyncNodes.push((node._error as NotReadyError)._source);
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
    if (!transition && activeTransition && activeTransition.time === clock) return;
    if (!activeTransition) {
      activeTransition = transition ?? {
        time: clock,
        pendingNodes: [],
        asyncNodes: [],
        optimisticNodes: [],
        optimisticStores: new Set(),
        actions: [],
        queueStash: { _queues: [[], []], _children: [] },
        done: false
      };
    } else if (transition) {
      activeTransition.done = transition;
      transition.actions.push(...activeTransition.actions);
      transitions.delete(activeTransition);
      activeTransition = transition;
    }
    transitions.add(activeTransition);
    activeTransition.time = clock;
    for (let i = 0; i < this._pendingNodes.length; i++) {
      const n = this._pendingNodes[i];
      n._transition = activeTransition;
      activeTransition.pendingNodes.push(n);
    }
    this._pendingNodes = activeTransition.pendingNodes;
    // Share reference - optimistic writes go directly to the transition's array
    for (let i = 0; i < this._optimisticNodes.length; i++) {
      const node = this._optimisticNodes[i];
      node._transition = activeTransition; // Mark ownership
      activeTransition.optimisticNodes.push(node);
    }
    this._optimisticNodes = activeTransition.optimisticNodes;
    // Move optimistic stores to transition
    for (const store of this._optimisticStores) {
      activeTransition.optimisticStores.add(store);
    }
    this._optimisticStores = activeTransition.optimisticStores;
  }
}

export function insertSubs(node: Signal<any> | Computed<any>, optimistic: boolean = false): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    if (optimistic) s._sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;

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
  checkBoundaryChildren(globalQueue);
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
      ? completingTransition.optimisticNodes
      : globalQueue._optimisticNodes;
    for (let i = 0; i < optimisticNodes.length; i++) {
      const n = optimisticNodes[i];
      const original = n._pendingValue;
      // Revert to the saved value
      if (original !== NOT_PENDING && n._value !== original) {
        n._value = original as any;
        insertSubs(n, true);
      }
      n._pendingValue = NOT_PENDING;
      n._transition = null; // Clear ownership
    }
    optimisticNodes.length = 0;

    // Clear optimistic stores
    const optimisticStores = completingTransition
      ? completingTransition.optimisticStores
      : globalQueue._optimisticStores;
    if (GlobalQueue._clearOptimisticStore && optimisticStores.size) {
      for (const store of optimisticStores) {
        GlobalQueue._clearOptimisticStore(store);
      }
      optimisticStores.clear();
      // Schedule another flush to process any dirty computeds (like projections)
      schedule();
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
  // After initTransition, globalQueue._optimisticStores IS activeTransition.optimisticStores (same reference)
  globalQueue._optimisticStores.add(store);
  schedule();
}

function runTransitionPending(pendingNodes: Signal<any>[]) {
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
  if (transition.done) return true;
  if (transition.actions.length) return false;
  let done = true;
  for (let i = 0; i < transition.asyncNodes.length; i++) {
    if (transition.asyncNodes[i]._statusFlags & STATUS_PENDING) {
      done = false;
      break;
    }
  }
  done && (transition.done = true);
  return done;
}
function currentTransition(transition: Transition) {
  while (transition.done && typeof transition.done === "object") transition = transition.done;
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
      ctx.actions.push(it);

      const done = (v?: R, e?: any) => {
        ctx = currentTransition(ctx);
        const i = ctx.actions.indexOf(it);
        if (i >= 0) ctx.actions.splice(i, 1);
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
