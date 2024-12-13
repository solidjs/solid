import {
  EFFECT_PURE,
  EFFECT_RENDER,
  EFFECT_USER,
  STATE_CLEAN,
  STATE_DISPOSED
} from "./constants.js";
import { Computation, incrementClock } from "./core.js";
import type { Effect } from "./effect.js";
import type { Owner } from "./owner.js";

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flushSync);
}

export interface IQueue {
  enqueue<T extends Computation | Effect>(type: number, node: T): void;
  run(type: number): void;
  flush(): void;
  addChild(child: IQueue): void;
  removeChild(child: IQueue): void;
}

class Queue implements IQueue {
  _running: boolean = false;
  _queues: [Computation[], Effect[], Effect[]] = [[], [], []];
  _children: IQueue[] = [];
  enqueue<T extends Computation | Effect>(type: number, node: T): void {
    this._queues[0].push(node as any);
    if (type) this._queues[type].push(node as any);
    schedule();
  }
  run(type: number) {
    if (this._queues[type].length) {
      if (type === EFFECT_PURE) {
        runPureQueue(this._queues[type]);
        this._queues[type] = [];
      } else {
        const effects = this._queues[type] as Effect[];
        this._queues[type] = [];
        runEffectQueue(effects);
      }
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
      this.run(EFFECT_RENDER);
      this.run(EFFECT_USER);
    } finally {
      this._running = false;
    }
  }
  addChild(child: IQueue) {
    this._children.push(child);
  }
  removeChild(child: IQueue) {
    const index = this._children.indexOf(child);
    if (index >= 0) this._children.splice(index, 1);
  }
}

export const globalQueue = new Queue();

/**
 * By default, changes are batched on the microtask queue which is an async process. You can flush
 * the queue synchronously to get the latest updates by calling `flushSync()`.
 */
export function flushSync(): void {
  globalQueue.flush();
  scheduled = false;
}

/**
 * When re-executing nodes, we want to be extra careful to avoid double execution of nested owners
 * In particular, it is important that we check all of our parents to see if they will rerun
 * See tests/createEffect: "should run parent effect before child effect" and "should run parent
 * memo before child effect"
 */
function runTop(node: Computation): void {
  const ancestors: Computation[] = [];

  for (let current: Owner | null = node; current !== null; current = current._parent) {
    if (current._state !== STATE_CLEAN) {
      ancestors.push(current as Computation);
    }
  }

  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i]._state !== STATE_DISPOSED) ancestors[i]._updateIfNecessary();
  }
}

function runPureQueue(queue: Computation[]) {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i]._state !== STATE_CLEAN) runTop(queue[i]);
  }
}

function runEffectQueue(queue: Effect[]) {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i]._modified && queue[i]._state !== STATE_DISPOSED) {
      queue[i]._effect(queue[i]._value, queue[i]._prevValue);
      queue[i]._modified = false;
      queue[i]._prevValue = queue[i]._value;
    }
  }
}
