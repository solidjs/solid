import { STATE_DIRTY } from "./constants.js";
import { Computation, compute, flatten, UNCHANGED } from "./core.js";
import { EagerComputation, type Effect } from "./effect.js";
import { ERROR_BIT, LOADING_BIT, UNINITIALIZED_BIT } from "./flags.js";
import { onCleanup, Owner } from "./owner.js";
import { incrementClock, Queue, type IQueue } from "./scheduler.js";

class BoundaryComputation<T> extends EagerComputation<T | undefined> {
  _propagationMask: number;
  constructor(compute: () => T, propagationMask: number) {
    super(undefined as any, compute, { defer: true });
    this._propagationMask = propagationMask;
  }
  write(value: T | UNCHANGED, flags: number) {
    super.write(value, flags & ~this._propagationMask);
    if(this._propagationMask & LOADING_BIT && !(this._stateFlags & UNINITIALIZED_BIT)) {
      flags &= ~LOADING_BIT;
    }
    this._queue.notify(this as any, this._propagationMask, flags);
    return this._value;
  }
}

function createBoundChildren<T>(owner: Owner, fn: () => T, queue: IQueue, mask: number): Computation<T> {
  const parentQueue = owner._queue;
  parentQueue.addChild((owner._queue = queue));
  onCleanup(() => parentQueue.removeChild(owner._queue!));
  return compute(
    owner,
    () => {
      const c = new Computation(undefined, fn);
      return new BoundaryComputation(() => flatten(c.wait()), mask);
    },
    null
  );
}

class ConditionalQueue extends Queue {
  _disabled: Computation<boolean>;
  _errorNodes: Set<Effect> = new Set();
  _pendingNodes: Set<Effect> = new Set();
  constructor(disabled: Computation<boolean>) {
    super();
    this._disabled = disabled;
  }
  run(type: number) {
    if (type && this._disabled.read()) return;
    return super.run(type);
  }
  notify(node: Effect, type: number, flags: number) {
    if (this._disabled.read()) {
      if (type === LOADING_BIT) {
        flags & LOADING_BIT ? this._pendingNodes.add(node) : this._pendingNodes.delete(node);
      }
      if (type === ERROR_BIT) {
        flags & ERROR_BIT ? this._errorNodes.add(node) : this._errorNodes.delete(node);
      }
      return true;
    }
    return super.notify(node, type, flags);
  }
}

export class CollectionQueue extends Queue {
  _collectionType: number;
  _nodes: Set<Effect> = new Set();
  _disabled: Computation<boolean> = new Computation(false, null);
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  notify(node: Effect, type: number, flags: number) {
    if (!(type & this._collectionType)) return super.notify(node, type, flags);
    if (flags & this._collectionType) {
      this._nodes.add(node);
      if (this._nodes.size === 1) this._disabled.write(true);
    } else {
      this._nodes.delete(node);
      if (this._nodes.size === 0) this._disabled.write(false);
    }
    type &= ~this._collectionType;
    return type ? super.notify(node, type, flags) : true;
  }
}

export enum BoundaryMode {
  VISIBLE = "visible",
  HIDDEN = "hidden",
}
export function createBoundary<T>(fn: () => T, condition: () => BoundaryMode) {
  const owner = new Owner();
  const queue = new ConditionalQueue(new Computation(undefined, () => condition() === BoundaryMode.HIDDEN));
  const tree = createBoundChildren(owner, fn, queue, 0);
  new EagerComputation(undefined, () => {
    const disabled = queue._disabled.read();
    (tree as BoundaryComputation<any>)._propagationMask = disabled ? ERROR_BIT | LOADING_BIT : 0;
    if (!disabled) {
      queue._pendingNodes.forEach(node => queue.notify(node, LOADING_BIT, LOADING_BIT));
      queue._errorNodes.forEach(node => queue.notify(node, ERROR_BIT, ERROR_BIT));
      queue._pendingNodes.clear();
      queue._errorNodes.clear();
    }
  });
  return () => queue._disabled.read() ? undefined : tree.read();
}

function createCollectionBoundary<T>(
  type: number,
  fn: () => any,
  fallback: (queue: CollectionQueue) => any
) {
  const owner = new Owner();
  const queue = new CollectionQueue(type);
  const tree = createBoundChildren(owner, fn, queue, type);
  const decision = new Computation(undefined, () => {
    if (!queue._disabled.read()) {
      const resolved = tree.read();
      if (!queue._disabled.read()) return resolved;
    }
    return fallback(queue);
  });
  return decision.read.bind(decision);
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
