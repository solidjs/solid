import {
  EFFECT_RENDER,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_ZOMBIE,
  STATUS_PENDING
} from "./constants.js";
import type { Computed, Signal } from "./core.js";
import type { NotReadyError } from "./error.js";
import { insertIntoHeap, runHeap, type Heap } from "./heap.js";

const transitions = new Set<Transition>();
export let optimisticRun = false;
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
  actions: Array<Generator<any, any, any> | AsyncGenerator<any, any, any>>;
  queueStash: QueueStub;
  done: boolean | Transition;
}

export function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!globalQueue._running) Promise.resolve().then(() => queueMicrotask(flush));
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
  run(type: number) {
    if (this._queues[type - 1].length) {
      const effects = this._queues[type - 1];
      this._queues[type - 1] = [];
      runQueue(effects, type);
    }
    for (let i = 0; i < this._children.length; i++) {
      this._children[i].run(type);
    }
  }
  enqueue(type: number, fn: QueueCallback): void {
    if (type) this._queues[type - 1].push(fn);
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
  static _update: (el: Computed<unknown>) => void;
  static _dispose: (el: Computed<unknown>, self: boolean, zombie: boolean) => void;
  flush() {
    if (this._running) return;
    this._running = true;
    try {
      runHeap(dirtyQueue, GlobalQueue._update);
      if (activeTransition) {
        if (!transitionComplete(activeTransition)) {
          let t = activeTransition;
          runHeap(zombieQueue, GlobalQueue._update);
          this._pendingNodes = [];
          this.stashQueues(activeTransition!.queueStash);
          clock++;
          scheduled = false;
          runTransitionPending(activeTransition!.pendingNodes, true);
          activeTransition = null;
          runOptimistic(t);
          return;
        }
        this._pendingNodes !== activeTransition.pendingNodes &&
          this._pendingNodes.push(...activeTransition.pendingNodes);
        this._optimisticNodes !== activeTransition.optimisticNodes &&
          this._optimisticNodes.push(...activeTransition.optimisticNodes);
        this.restoreQueues(activeTransition.queueStash);
        transitions.delete(activeTransition);
        activeTransition = null;
        runTransitionPending(this._pendingNodes, false);
      } else if (transitions.size) runHeap(zombieQueue, GlobalQueue._update);
      runOptimistic();
      clock++;
      scheduled = false;
      this.run(EFFECT_RENDER);
      this.run(EFFECT_USER);
    } finally {
      this._running = false;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number): boolean {
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        if (
          activeTransition &&
          !activeTransition.asyncNodes.includes((node._error as NotReadyError).cause)
        ) {
          activeTransition.asyncNodes.push((node._error as NotReadyError).cause);
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
    for (let i = 0; i < this._optimisticNodes.length; i++) {
      const n = this._optimisticNodes[i];
      n._transition = activeTransition;
      activeTransition.optimisticNodes.push(n);
    }
    this._pendingNodes = activeTransition.pendingNodes;
    this._optimisticNodes = activeTransition.optimisticNodes;
  }
}

export function notifySubs(node: Signal<any> | Computed<any>): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const queue = s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
    if (queue._min > s._sub._height) queue._min = s._sub._height;
    insertIntoHeap(s._sub, queue);
  }
}

export function runOptimistic(activeTransition: Transition | null = null) {
  let resolvePending = !activeTransition;
  const optimisticNodes = globalQueue._optimisticNodes;
  optimisticRun = true;
  for (let i = 0; i < optimisticNodes.length; i++) {
    const n = optimisticNodes[i];
    if (!activeTransition && (!n._transition || n._transition.done)) {
      if (n._pendingValue !== NOT_PENDING) {
        n._value = n._pendingValue as any;
        n._pendingValue = NOT_PENDING;
      }
      if ((n as any)._reset) (n as any)._reset();
    }
    n._transition = activeTransition;
    notifySubs(n);
  }
  globalQueue._optimisticNodes = [];
  if (dirtyQueue._max >= dirtyQueue._min) {
    resolvePending = true;
    runHeap(dirtyQueue, GlobalQueue._update);
  }
  optimisticRun = false;
  resolvePending && runPending(globalQueue._pendingNodes);
}

function runPending(pendingNodes: Signal<any>[]) {
  for (let i = 0; i < pendingNodes.length; i++) {
    const n = pendingNodes[i];
    if (n._pendingValue !== NOT_PENDING) {
      n._value = n._pendingValue as any;
      n._pendingValue = NOT_PENDING;
      if ((n as any)._type) (n as any)._modified = true;
    }
    if ((n as Computed<unknown>)._fn) GlobalQueue._dispose(n as Computed<unknown>, false, true);
  }
  pendingNodes.length = 0;
}

function runTransitionPending(pendingNodes, value: boolean) {
  const p = pendingNodes.slice();
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    // set or unset the transition
    n._transition = activeTransition;
    if (n._pendingCheck) {
      n._pendingCheck._transition = activeTransition;
      n._pendingCheck._set(value);
    }
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
  activeTransition = null;
  try {
    activeTransition = currentTransition(transition);
    return fn();
  } finally {
    activeTransition = prevTransition;
  }
}

export function action<Args extends any[], Y, R>(
  genFn: (...args: Args) => Generator<Y, R, any> | AsyncGenerator<Y, R, any>
) {
  return (...args: Args): void => {
    const iterator = genFn(...args);
    globalQueue.initTransition();
    let ctx = activeTransition!;
    ctx!.actions.push(iterator);
    const step = (input?: any) => {
      let nextValue = iterator.next(input);
      if (nextValue instanceof Promise) return nextValue.then(process);
      process(nextValue);
    };
    const process = (result: IteratorResult<Y, R>) => {
      if (result.done) {
        ctx = currentTransition(ctx);
        ctx.actions.splice(ctx.actions.indexOf(iterator), 1);
        activeTransition = ctx;
        schedule();
        flush();
        return;
      }
      const yielded = result.value;
      if (yielded instanceof Promise) return yielded.then(v => runInTransition(ctx, () => step(v)));
      runInTransition(ctx, () => step(yielded));
    };
    runInTransition(ctx, () => step());
  };
}
