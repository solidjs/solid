import { EFFECT_PURE, EFFECT_RENDER, EFFECT_USER } from "./constants.js";
import type { Computation, ObserverType, SourceType } from "./core.js";
import type { Effect } from "./effect.js";
import { LOADING_BIT } from "./flags.js";

export let clock = 0;
export function incrementClock(): void {
  clock++;
}
export let ActiveTransition: Transition | null = null;

let unobserved: SourceType[] = [];
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!globalQueue._running) queueMicrotask(flush);
}

function notifyUnobserved(): void {
  for (let i = 0; i < unobserved.length; i++) {
    const source = unobserved[i];
    if (!source._observers || !source._observers.length) unobserved[i]._unobserved?.(); // Call the unobserved callback if it exists
  }
  unobserved = [];
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
  _parent: IQueue | null;
}

let pureQueue: QueueCallback[] = [];
export class Queue implements IQueue {
  _parent: IQueue | null = null;
  _running: boolean = false;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _children: IQueue[] = [];
  created = clock;
  enqueue(type: number, fn: QueueCallback): void {
    if (ActiveTransition) return ActiveTransition.enqueue(type, fn);
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
      unobserved.length && notifyUnobserved();
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
  notify(...args: any[]) {
    if (this._parent) return this._parent.notify(...args);
    return false;
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

function runQueue(queue: QueueCallback[], type: number): void {
  for (let i = 0; i < queue.length; i++) queue[i](type);
}

export class Transition implements IQueue {
  _sources: Map<Computation, Computation> = new Map();
  _pendingNodes: Set<Effect> = new Set();
  _promises: Set<Promise<any>> = new Set();
  _optimistic: Set<Computation & { _reset: () => void }> = new Set();
  _done: boolean = false;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _pureQueue: QueueCallback[] = [];
  _children: IQueue[] = [];
  _parent: IQueue | null = null;
  _running: boolean = false;
  _scheduled: boolean = false;
  created: number = clock;
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
    if (this._running) return;
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
  schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    if (!this._running) queueMicrotask(() => this.flush());
  }
  runTransition(fn: () => any | Promise<any>) {
    if (this._done) throw new Error("Transition already completed");
    ActiveTransition = this;
    try {
      const result = fn();
      if (result instanceof Promise) {
        this._promises.add(result);
        result.finally(() => {
          this._promises.delete(result);
          finishTransition(this);
        });
      }
    } finally {
      finishTransition(this);
      ActiveTransition = null;
    }
  }
}


const Transitions = new Set();

/**
 * Runs the given function in a transition scope, allowing for batch updates and optimizations.
 * This is useful for grouping multiple state updates together to avoid unnecessary re-renders.
 *
 * @param fn A function that receives a resume function to continue the transition.
 * The resume function can be called with another function to continue the transition.
 *
 * @description https://docs.solidjs.com/reference/advanced-reactivity/transition
 */
export function transition(
  fn: (resume: (fn: () => any | Promise<any>) => void) => any | Promise<any>
): void {
  let t: Transition = new Transition();
  queueMicrotask(() => t.runTransition(() => fn(fn => t.runTransition(fn))));
}

export function cloneGraph(node: Computation): Computation {
  if (node._transition) {
    if (node._transition !== ActiveTransition) {
      // we need to merge transitions
      ActiveTransition!._sources.forEach((value, key) => node._transition!._sources.set(key, value));
      ActiveTransition!._optimistic.forEach(c => node._transition!._optimistic.add(c));
      ActiveTransition!._promises.forEach(p => node._transition!._promises.add(p));
      ActiveTransition!._pendingNodes.forEach(n => node._transition!._pendingNodes.add(n));
      ActiveTransition!._queues[0].forEach(f => node._transition!._queues[0].push(f));
      ActiveTransition!._queues[1].forEach(f => node._transition!._queues[1].push(f));
      ActiveTransition!._pureQueue.forEach(f => node._transition!._pureQueue.push(f));
      ActiveTransition!._children.forEach(c => node._transition!.addChild(c));
      ActiveTransition = node._transition;
    }
    return node._transition._sources.get(node)!;
  }
  const clone = Object.create(Object.getPrototypeOf(node)) as Computation;
  Object.assign(clone, node, { _disposal: null, _nextSibling: null, _cloned: node });
  ActiveTransition!._sources.set(node, clone);
  node._transition = ActiveTransition!;
  if (node._observers) {
    for (let i = 0, length = node._observers.length; i < length; i++) {
      const o = node._observers[i];
      node._observers.push(cloneGraph(o as any));
    }
  }
  return clone;
}

export function removeSourceObservers(node: ObserverType, index: number): void {
  let source: SourceType;
  let swap: number;
  for (let i = index; i < node._sources!.length; i++) {
    source =
      (ActiveTransition && ActiveTransition._sources.get(node._sources![i] as any)) ||
      node._sources![i];
    if (source._observers) {
      if ((swap = source._observers.indexOf(node)) !== -1) {
        source._observers[swap] = source._observers[source._observers.length - 1];
        source._observers.pop();
      }
      if (!source._observers.length) unobserved.push(source);
    }
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
  for (const [source, clone] of transition._sources) {
    if (source === clone || source._transition !== transition) continue; // already merged
    if (clone._sources) removeSourceObservers(clone, 0);
    source.dispose(false);
    source.emptyDisposal();
    Object.assign(source, clone);
    delete source._cloned;
    delete source._transition;
  }
  transition._done = true;
  Transitions.delete(transition);

  // run the queued effects
  transition.run(EFFECT_RENDER);
  transition.run(EFFECT_USER);

  for (const c of transition._optimistic) c._reset();
}
