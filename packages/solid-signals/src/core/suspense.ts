import { Computation, untrack } from "./core.js";
import { EagerComputation, type Effect } from "./effect.js";
import { LOADING_BIT } from "./flags.js";
import { createBoundary, Queue, queueTask } from "./scheduler.js";
import { flatten } from "./utils.js";

export class SuspenseQueue extends Queue {
  _nodes: Set<Effect> = new Set();
  _fallback = false;
  _signal = new Computation(false, null);
  run(type: number) {
    if (type && this._fallback) return;
    return super.run(type);
  }
  _update(node: Effect) {
    if (node._stateFlags & LOADING_BIT) {
      this._nodes.add(node);
      if (!this._fallback) {
        this._fallback = true;
        queueTask(() => this._signal.write(true));
      }
    } else {
      this._nodes.delete(node);
      if (this._nodes.size === 0) {
        this._fallback = false;
        queueTask(() => this._signal.write(false));
      }
    }
  }
}

class LiveComputation<T> extends EagerComputation<T> {
  override write(value: T, flags = 0): T {
    const currentFlags = this._stateFlags;
    super.write(value, flags);
    if ((flags & LOADING_BIT) !== (currentFlags & LOADING_BIT)) {
      (this._queue as SuspenseQueue)._update?.(this as any);
    }
    return this._value as T;
  }
}

export function createSuspense(fn: () => any, fallback: () => any) {
  const queue = new SuspenseQueue();
  const tree = createBoundary(() => {
    const child = new Computation(null, fn);
    return new LiveComputation(null, () => flatten(child.wait()));
  }, queue);
  const equality = new Computation(null, () => queue._signal.read() || queue._fallback);
  const comp = new Computation(null, () => (equality.read() ? fallback() : tree.read()));
  return comp.read.bind(comp);
}
