import { EFFECT_PURE, EFFECT_RENDER, EFFECT_USER, STATE_DISPOSED } from "./constants.js";
import type { Computation, ObserverType, SourceType } from "./core.js";
import type { Effect } from "./effect.js";
import { LOADING_BIT } from "./flags.js";

export let clock = 0;
export function incrementClock(): void {
  clock++;
}
export let ActiveTransition: Transition | null = null;
export let Unobserved: SourceType[] = [];
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!globalQueue._running) queueMicrotask(flush);
}

function notifyUnobserved(): void {
  for (let i = 0; i < Unobserved.length; i++) {
    const source = Unobserved[i];
    // TODO better automatic disposal handling
    if (!source._observers || !source._observers.length) Unobserved[i]._unobserved?.(); // Call the unobserved callback if it exists
  }
  Unobserved = [];
}

export type QueueCallback = (type: number) => void;
export interface IQueue {
  enqueue(type: number, fn: QueueCallback): void;
  run(type: number): boolean | void;
  flush(): void;
  addChild(child: IQueue): void;
  removeChild(child: IQueue): void;
  created: number;
  notify(...args: any[]): boolean;
  merge(queue: IQueue): void;
  _parent: IQueue | null;
  _cloned?: IQueue | undefined;
}

let pureQueue: QueueCallback[] = [];
export class Queue implements IQueue {
  _parent: IQueue | null = null;
  _running: boolean = false;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _children: IQueue[] = [];
  created = clock;
  enqueue(type: number, fn: QueueCallback): void {
    pureQueue.push(fn);
    if (type) this._queues[type - 1].push(fn);
    schedule();
  }
  run(type: number) {
    if (type === EFFECT_PURE) {
      pureQueue.length && runQueue(pureQueue, type);
      pureQueue = [];
      return;
    } else if (this._queues[type - 1].length) {
      const effects = this._queues[type - 1];
      this._queues[type - 1] = [];
      runQueue(effects, type);
    }
    for (let i = 0; i < this._children.length; i++) {
      this._children[i].run(type);
    }
  }
  flush() {
    if (this._running) return;
    this._running = true;
    try {
      this.run(EFFECT_PURE);
      incrementClock();
      scheduled = false;
      this.run(EFFECT_RENDER);
      this.run(EFFECT_USER);
    } finally {
      this._running = false;
      Unobserved.length && notifyUnobserved();
    }
  }
  addChild(child: IQueue) {
    if (ActiveTransition && ActiveTransition._clonedQueues.has(this))
      return ActiveTransition._clonedQueues.get(this)!.addChild(child);
    this._children.push(child);
    child._parent = this;
  }
  removeChild(child: IQueue) {
    if (ActiveTransition && ActiveTransition._clonedQueues.has(this))
      return ActiveTransition._clonedQueues.get(this)!.removeChild(child);
    const index = this._children.indexOf(child);
    if (index >= 0) {
      this._children.splice(index, 1);
      child._parent = null;
    }
  }
  notify(...args: any[]) {
    if (this._parent) return this._parent.notify(...args);
    return false;
  }
  merge(queue: Queue) {
    this._queues[0].push.apply(this._queues[0], queue._queues[0]);
    this._queues[1].push.apply(this._queues[1], queue._queues[1]);
    for (let i = 0; i < queue._children.length; i++) {
      const og = this._children.find(c => c._cloned === (queue._children[i] as any)._cloned);
      if (og) og.merge(queue._children[i]);
      else this.addChild(queue._children[i]);
    }
  }
}

export const globalQueue = new Queue();

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

export function removeSourceObservers(node: ObserverType, index: number): void {
  let source: SourceType;
  let swap: number;
  for (let i = index; i < node._sources!.length; i++) {
    source = getTransitionSource(node._sources![i] as any);
    if (source._observers) {
      if ((swap = source._observers.indexOf(node)) !== -1) {
        source._observers[swap] = source._observers[source._observers.length - 1];
        source._observers.pop();
      }
      if (!source._observers.length) Unobserved.push(source);
    }
  }
}

function runQueue(queue: QueueCallback[], type: number): void {
  for (let i = 0; i < queue.length; i++) queue[i](type);
}

export class Transition implements IQueue {
  _sources: Map<Computation, Computation> = new Map();
  _pendingNodes: Set<Effect> = new Set();
  _promises: Set<Promise<any>> = new Set();
  _optimistic: Set<(() => void) & { _transition?: Transition }> = new Set();
  _done: Transition | boolean = false;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _clonedQueues: Map<Queue, Queue> = new Map();
  _pureQueue: QueueCallback[] = [];
  _children: IQueue[] = [];
  _parent: IQueue | null = null;
  _running: boolean = false;
  _scheduled: boolean = false;
  _cloned = globalQueue;
  _signal: Computation;
  created: number = clock;
  constructor(signal: Computation) {
    this._signal = signal;
    this._clonedQueues.set(globalQueue, this);
    for (const child of globalQueue._children) {
      cloneQueue(child as Queue, this, this);
    }
  }
  enqueue(type: number, fn: QueueCallback): void {
    this._pureQueue.push(fn);
    if (type) this._queues[type - 1].push(fn);
    this.schedule();
  }
  run(type: number) {
    if (type === EFFECT_PURE) {
      this._pureQueue.length && runQueue(this._pureQueue, type);
      this._pureQueue = [];
      return;
    } else if (this._queues[type - 1].length) {
      const effects = this._queues[type - 1];
      this._queues[type - 1] = [];
      runQueue(effects, type);
    }
    for (let i = 0; i < this._children.length; i++) {
      this._children[i].run(type);
    }
  }
  flush() {
    if (this._running || this._done) return;
    // update main branch first
    globalQueue.flush();

    this._running = true;
    let currentTransition = ActiveTransition;
    ActiveTransition = this;
    try {
      this.run(EFFECT_PURE);
      incrementClock();
      this._scheduled = false;
      ActiveTransition = currentTransition;
      finishTransition(this);
    } finally {
      this._running = false;
      ActiveTransition = currentTransition;
    }
  }
  addChild(child: IQueue) {
    this._children.push(child);
    child._parent = this;
  }
  removeChild(child: IQueue) {
    const index = this._children.indexOf(child);
    if (index >= 0) this._children.splice(index, 1);
  }
  notify(node: Effect, type: number, flags: number) {
    if (!(type & LOADING_BIT)) return false;
    if (flags & LOADING_BIT) {
      this._pendingNodes.add(node);
    } else {
      this._pendingNodes.delete(node);
    }
    return true;
  }
  merge(queue: Transition) {
    this._queues[0].push.apply(this._queues[0], queue._queues[0]);
    this._queues[1].push.apply(this._queues[1], queue._queues[1]);
    this._pureQueue.push.apply(this._pureQueue, queue._pureQueue);
    queue._queues[0].length = 0;
    queue._queues[1].length = 0;
    queue._pureQueue.length = 0;
    for (let i = 0; i < queue._children.length; i++) {
      const og = this._children.find(c => c._cloned === (queue._children[i] as any)._cloned);
      if (og) og.merge(queue._children[i]);
      else this.addChild(queue._children[i]);
    }
  }
  schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    if (!this._running) queueMicrotask(() => this.flush());
  }
  runTransition(fn: () => any | Promise<any>, force = false): void {
    if (this._done) {
      if (this._done instanceof Transition) return this._done.runTransition(fn, force);
      if (!force) throw new Error("Transition already completed");
      fn();
      return;
    }
    ActiveTransition = this;
    try {
      let result = fn();
      let transition = ActiveTransition;
      if (result?.next) {
        (async function () {
          let temp, value;
          while (!(temp = result.next(value)).done) {
            transition = ActiveTransition;
            if (temp.value instanceof Promise) {
              transition._promises.add(temp.value);
              try {
                value = await temp.value;
              } finally {
                transition = latestTransition(transition);
                transition._promises.delete(temp.value);
              }
              ActiveTransition = transition;
            } else value = temp.value;
          }
          ActiveTransition = null;
          finishTransition(transition);
        })();
      }
      if (result instanceof Promise) {
        transition._promises.add(result);
        result.finally(() => {
          transition = latestTransition(transition);
          transition._promises.delete(result);
          ActiveTransition = null;
          finishTransition(transition);
        });
      }
    } finally {
      const transition = ActiveTransition;
      ActiveTransition = null;
      finishTransition(transition);
    }
  }
  addOptimistic(fn: (() => void) & { _transition?: Transition }) {
    if (fn._transition && fn._transition !== this) {
      mergeTransitions(fn._transition, this);
      ActiveTransition = fn._transition!;
      return;
    }
    fn._transition = this;
    this._optimistic.add(fn as any);
  }
}

export function cloneGraph(node: Computation): Computation {
  if (node._optimistic) {
    if (node._state !== STATE_DISPOSED) {
      node._optimistic._init?.();
      ActiveTransition!.addOptimistic(node._optimistic);
    }
    return node;
  }
  if (node._transition) {
    if (node._transition !== ActiveTransition) {
      mergeTransitions(node._transition, ActiveTransition!);
      ActiveTransition = node._transition;
    }
    return node._transition._sources.get(node)!;
  }
  const clone = Object.create(Object.getPrototypeOf(node)) as Computation;
  Object.assign(clone, node, {
    _disposal: null,
    _nextSibling: null,
    _observers: null,
    _sources: node._sources ? [...node._sources] : null,
    _cloned: node
  });
  delete (clone as any)._prevValue;
  ActiveTransition!._sources.set(node, clone);
  node._transition = ActiveTransition!;
  if (node._sources) {
    for (let i = 0; i < node._sources.length; i++) node._sources[i]._observers!.push(clone);
  }
  if (node._observers) {
    clone._observers = [];
    for (let i = 0, length = node._observers.length; i < length; i++) {
      !(node._observers[i] as Computation)._cloned &&
        clone._observers.push(cloneGraph(node._observers[i] as any));
    }
  }
  return clone;
}

function latestTransition(t: Transition): Transition {
  while (t._done instanceof Transition) t = t._done;
  return t;
}

function replaceSourceObservers(node: ObserverType, transition: Transition) {
  let source: SourceType;
  let transitionSource: SourceType | undefined;
  let swap: number;
  for (let i = 0; i < node._sources!.length; i++) {
    transitionSource = transition._sources.get(node._sources![i] as any);
    source = transitionSource || node._sources![i];
    if (source._observers && (swap = source._observers.indexOf(node)) !== -1) {
      source._observers[swap] = transitionSource
        ? (node as any)._cloned
        : source._observers[source._observers.length - 1];
      !transitionSource && source._observers.pop();
    }
  }
}

function cloneQueue(queue: Queue, parent: Queue, transition: Transition) {
  const clone = Object.create(Object.getPrototypeOf(queue)) as Queue;
  Object.assign(clone, queue, {
    _cloned: queue,
    _parent: parent,
    _children: [],
    enqueue(type, fn) {
      transition = latestTransition(transition);
      transition.enqueue(type, fn);
    },
    notify(node: Effect, type: number, flags: number) {
      node = (node._cloned || node) as Effect;
      if (!(clone as any)._collectionType || type & LOADING_BIT) {
        type &= ~LOADING_BIT;
        transition = latestTransition(transition);
        transition.notify(node, LOADING_BIT, flags);
        if (!type) return true;
      }
      return queue.notify.call(this, node, type, flags);
    }
  });
  parent._children.push(clone);
  transition._clonedQueues.set(queue, clone);
  for (const child of queue._children) {
    cloneQueue(child as Queue, clone, transition);
  }
}

function resolveQueues(children: Queue[]) {
  for (const child of children) {
    const og = (child as any)._cloned;
    if (og) {
      const clonedChildren = child._children;
      delete (child as any).enqueue;
      delete (child as any).notify;
      delete (child as any)._parent;
      delete (child as any)._children;
      Object.assign(og, child);
      delete og._cloned;
      resolveQueues(clonedChildren as Queue[]);
    } else if (child._parent!._cloned) {
      child._parent!._cloned.addChild(child);
    }
  }
}

function mergeTransitions(t1: Transition, t2: Transition) {
  t2._sources.forEach((value, key) => {
    key._transition = t1;
    t1._sources.set(key, value);
  });
  t2._optimistic.forEach(c => {
    c._transition = t1;
    t1._optimistic.add(c);
  });
  t2._promises.forEach(p => t1._promises.add(p));
  t2._pendingNodes.forEach(n => t1._pendingNodes.add(n));
  t1.merge(t2);
  t2._done = t1;
}

export function getOGSource<T extends Computation>(input: T): T {
  return input?._cloned || (input as any);
}

export function getTransitionSource<T extends Computation>(input: T): T {
  return (ActiveTransition && ActiveTransition._sources.get(input)) || (input as any);
}

export function getQueue(node: Computation): IQueue {
  const transition = ActiveTransition || node._cloned?._transition;
  return (transition && transition._clonedQueues.get(node._queue as Queue)) || node._queue;
}

export function initialDispose(node) {
  let current = node._nextSibling as Computation | null;
  while (current !== null && current._parent === node) {
    initialDispose(current);
    const clone = ActiveTransition!._sources.get(current);
    if (clone && !(clone as any)._updated) clone.dispose(true);
    current = current._nextSibling as Computation | null;
  }
}

function finishTransition(transition: Transition) {
  if (
    transition._done ||
    transition._scheduled ||
    transition._promises.size ||
    transition._pendingNodes.size
  )
    return;
  // do the actual merging
  globalQueue._queues[0].push.apply(globalQueue._queues[0], transition._queues[0]);
  globalQueue._queues[1].push.apply(globalQueue._queues[1], transition._queues[1]);
  resolveQueues(transition._children as Queue[]);

  for (const [source, clone] of transition._sources) {
    if (source === clone || source._transition !== transition) {
      delete source._transition;
      continue; // already merged
    }
    if (clone._sources) replaceSourceObservers(clone, transition);
    // check if we need to dispose
    if ((clone as any)._updated || clone._state === STATE_DISPOSED) {
      source.dispose(clone._state === STATE_DISPOSED);
      source.emptyDisposal();
      delete (clone as any)._updated;
    } else {
      delete (clone as any)._nextSibling;
      delete (clone as any)._disposal;
    }
    Object.assign(source, clone);
    delete source._cloned;

    let current = clone._nextSibling as Computation | null;
    if (current?._prevSibling === clone) current._prevSibling = source;
    while (current?._parent === clone) {
      current._parent = source;
      current = current._nextSibling as Computation | null;
    }
    delete source._transition;
  }
  transition._done = true;

  // clear optimistic updates
  for (const reset of transition._optimistic) {
    delete reset._transition;
    reset();
  }
  transition._signal.write(true);
  // run the queued effects
  globalQueue.flush();
}
