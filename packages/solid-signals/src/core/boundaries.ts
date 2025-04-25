import { STATE_DIRTY } from "./constants.js";
import { Computation, compute, flatten } from "./core.js";
import { EagerComputation, type Effect } from "./effect.js";
import { ERROR_BIT, LOADING_BIT } from "./flags.js";
import { onCleanup, Owner } from "./owner.js";
import { incrementClock, Queue, type IQueue } from "./scheduler.js";

function createBoundary<T>(owner: Owner, fn: () => T, queue: IQueue): Computation<T> {
  const parentQueue = owner._queue;
  parentQueue.addChild((owner._queue = queue));
  onCleanup(() => parentQueue.removeChild(owner._queue!));
  return compute(
    owner,
    () => {
      const c = new Computation(undefined, fn);
      return new EagerComputation(undefined, () => flatten(c.wait()), { defer: true });
    },
    null
  );
}

function createCollectionBoundary<T>(
  type: number,
  fn: () => any,
  fallback: (queue: CollectionQueue) => any
) {
  const owner = new Owner();
  const queue = new CollectionQueue(type);
  const tree = createBoundary(owner, fn, queue);
  const ogWrite = tree.write;
  tree.write = function <T>(value: T, flags = 0): T {
    ogWrite.call(this, value, flags & ~type);
    (this._queue as CollectionQueue)._update(this as any, type, flags);
    return this._value;
  };
  const decision = new Computation(undefined, () => {
    if (!queue._fallback.read()) {
      const resolved = tree.read();
      if (!queue._fallback.read()) return resolved;
    }
    return fallback(queue);
  });
  return decision.read.bind(decision);
}

export class CollectionQueue extends Queue {
  _collectionType: number;
  _nodes: Set<Effect> = new Set();
  _fallback = new Computation(false, null);
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  run(type: number) {
    if (type && this._fallback.read()) return;
    return super.run(type);
  }
  _update(node: Effect, type: number, flags: number) {
    if (type !== this._collectionType) {
      let parent: IQueue | null = this;
      while ((parent = parent._parent)) {
        if ((parent as CollectionQueue)._collectionType === type) {
          return (parent as CollectionQueue)._update(node, type, flags);
        }
      }
      return false;
    }
    if (flags & this._collectionType) {
      this._nodes.add(node);
      if (this._nodes.size === 1) this._fallback.write(true);
    } else {
      this._nodes.delete(node);
      if (this._nodes.size === 0) this._fallback.write(false);
    }
    return true;
  }
}

export function createSuspense(fn: () => any, fallback: () => any) {
  return createCollectionBoundary(LOADING_BIT, fn, () => fallback());
}

export function createErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
) {
  return createCollectionBoundary(ERROR_BIT, fn, queue =>
    fallback(queue._nodes!.values().next().value!._error, () => {
      incrementClock();
      for (let node of queue._nodes) {
        (node as any)._state = STATE_DIRTY;
        (node as any)._queue?.enqueue((node as any)._type, node);
      }
    })
  );
}
