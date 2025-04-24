import { STATE_DIRTY } from "./constants.js";
import { Computation, compute, flatten } from "./core.js";
import { EagerComputation, type Effect } from "./effect.js";
import { LOADING_BIT } from "./flags.js";
import { onCleanup, Owner } from "./owner.js";
import { incrementClock, Queue, type IQueue } from "./scheduler.js";

function createBoundary<T>(owner: Owner, fn: () => T, queue?: IQueue): Computation<T> {
  if (queue) {
    const parentQueue = owner._queue;
    parentQueue.addChild((owner._queue = queue));
    onCleanup(() => parentQueue.removeChild(owner._queue!));
  }
  return compute(
    owner,
    () => {
      const c = new Computation(undefined, fn);
      return new EagerComputation(undefined, () => flatten(c.wait()), { defer: true });
    },
    null
  );
}

function createDecision(main, condition, fallback) {
  const decision = new Computation(undefined, () => {
    if (!condition.read()) {
      const resolved = main.read();
      if (!condition.read()) return resolved;
    }
    return fallback();
  });
  return decision.read.bind(decision);
}

export class SuspenseQueue extends Queue {
  _nodes: Set<Effect> = new Set();
  _fallback = new Computation(false, null);
  run(type: number) {
    if (type && this._fallback.read()) return;
    return super.run(type);
  }
  _update(node: Effect) {
    if (node._stateFlags & LOADING_BIT) {
      this._nodes.add(node);
      if (this._nodes.size === 1) this._fallback.write(true);
    } else {
      this._nodes.delete(node);
      if (this._nodes.size === 0) this._fallback.write(false);
    }
  }
}

export function createSuspense(fn: () => any, fallback: () => any) {
  const owner = new Owner();
  const queue = new SuspenseQueue();
  const tree = createBoundary(owner, fn, queue);
  const ogWrite = tree.write;
  tree.write = function <T>(value: T, flags = 0): T {
    const currentFlags = this._stateFlags;
    const dirty = this._state === STATE_DIRTY;
    ogWrite.call(this, value, flags);
    if (dirty && (flags & LOADING_BIT) !== (currentFlags & LOADING_BIT)) {
      (this._queue as SuspenseQueue)._update?.(this as any);
    }
    return this._value as T;
  };
  return createDecision(tree, queue._fallback, fallback);
}

export function createErrorBoundary<T, U>(
  fn: () => T,
  fallback: (error: unknown, reset: () => void) => U
) {
  const owner = new Owner();
  const error = new Computation<{ _error: any } | undefined>(undefined, null);
  const nodes = new Set<Owner>();
  function handler(err: unknown, node: Owner) {
    if (nodes.has(node)) return;
    compute(
      node,
      () =>
        onCleanup(() => {
          nodes.delete(node);
          if (!nodes.size) error.write(undefined);
        }),
      null
    );
    nodes.add(node);
    if (nodes.size === 1) error.write({ _error: err });
  }
  owner.addErrorHandler(handler);
  const tree = createBoundary(owner, fn);
  tree._setError = tree.handleError;
  return createDecision(tree, error, () =>
    fallback(error.read()!._error, () => {
      incrementClock();
      for (let node of nodes) {
        (node as any)._state = STATE_DIRTY;
        (node as any)._queue?.enqueue((node as any)._type, node);
      }
    })
  );
}
