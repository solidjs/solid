import { EffectType, NOT_PENDING, StatusFlags } from "./constants.js";
import type { Computed, Signal } from "./core.js";
import type { NotReadyError } from "./error.js";
import { runHeap, type Heap } from "./heap.js";

export let clock = 0;
export let activeTransition: Transition | null = null;
export let unobserved: Signal<unknown>[] = [];
const transitions = new Set<Transition>();

export type QueueCallback = (type: number) => void;
type QueueStub = {
  _queues: [QueueCallback[], QueueCallback[]];
  _children: QueueStub[];
};
export interface Transition {
  time: number;
  asyncNodes: Computed<any>[];
  pendingNodes: Signal<any>[];
  queueStash: QueueStub;
}

let scheduled = false;
export function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!globalQueue._running) queueMicrotask(flush);
}

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
  static _update: (el: Computed<unknown>) => void;
  static _dispose: (el: Computed<unknown>, self: boolean, zombie: boolean) => void;
  flush() {
    if (this._running) return;
    this._running = true;
    try {
      runHeap(dirtyQueue, GlobalQueue._update);
      if (activeTransition) {
        if (!transitionComplete(activeTransition)) {
          runHeap(zombieQueue, GlobalQueue._update);
          globalQueue._pendingNodes = [];
          globalQueue.stashQueues(activeTransition!.queueStash);
          clock++;
          scheduled = false;
          runPending(activeTransition!.pendingNodes, true);
          activeTransition = null;
          return;
        }
        globalQueue._pendingNodes.push(...activeTransition.pendingNodes);
        globalQueue.restoreQueues(activeTransition.queueStash);
        transitions.delete(activeTransition);
        activeTransition = null;
        if (runPending(globalQueue._pendingNodes, false)) runHeap(dirtyQueue, GlobalQueue._update);
      } else if (transitions.size) runHeap(zombieQueue, GlobalQueue._update);
      for (let i = 0; i < globalQueue._pendingNodes.length; i++) {
        const n = globalQueue._pendingNodes[i];
        if (n._pendingValue !== NOT_PENDING) {
          n._value = n._pendingValue as any;
          n._pendingValue = NOT_PENDING;
        }
        if ((n as Computed<unknown>)._fn) GlobalQueue._dispose(n as Computed<unknown>, false, true);
      }
      globalQueue._pendingNodes.length = 0;
      clock++;
      scheduled = false;
      this.run(EffectType.Render);
      this.run(EffectType.User);
    } finally {
      this._running = false;
      unobserved.length && notifyUnobserved();
    }
  }
  notify(node: Computed<any>, mask: number, flags: number): boolean {
    if (mask & StatusFlags.Pending) {
      if (flags & StatusFlags.Pending) {
        if (
          activeTransition &&
          !activeTransition.asyncNodes.includes((node._error as NotReadyError).cause)
        )
          activeTransition.asyncNodes.push((node._error as NotReadyError).cause);
      }
      return true;
    }
    return false;
  }
  initTransition(node: Computed<any>): void {
    if (activeTransition && activeTransition.time === clock) return;
    if (!activeTransition) {
      activeTransition = node._transition ?? {
        time: clock,
        pendingNodes: [],
        asyncNodes: [],
        queueStash: { _queues: [[], []], _children: [] }
      };
    }
    transitions.add(activeTransition);
    activeTransition.time = clock;
    for (let i = 0; i < globalQueue._pendingNodes.length; i++) {
      const n = globalQueue._pendingNodes[i];
      n._transition = activeTransition;
      activeTransition.pendingNodes.push(n);
    }
    globalQueue._pendingNodes = activeTransition.pendingNodes;
  }
}

function runPending(pendingNodes, value: boolean) {
  let needsReset = false;
  const p = pendingNodes.slice();
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    // set or unset the transition
    n._transition = activeTransition;
    if (n._pendingCheck) {
      n._pendingCheck._set(value);
      needsReset = true;
    }
  }
  return needsReset;
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

export function transitionComplete(transition: Transition): boolean {
  let done = true;
  for (let i = 0; i < transition.asyncNodes.length; i++) {
    if (transition.asyncNodes[i]._statusFlags & StatusFlags.Pending) {
      done = false;
      break;
    }
  }
  return done;
}

function notifyUnobserved(): void {
  for (let i = 0; i < unobserved.length; i++) {
    const source = unobserved[i];
    // TODO better automatic disposal handling
    if (!source._subs) unobserved[i]._unobserved?.(); // Call the unobserved callback if it exists
  }
  unobserved = [];
}
