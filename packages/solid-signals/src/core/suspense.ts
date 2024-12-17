import { Computation, untrack } from "./core.js";
import type { Effect } from "./effect.js";
import { LOADING_BIT } from "./flags.js";
import { createBoundary, Queue } from "./scheduler.js";

export class SuspenseQueue extends Queue {
  _nodes: Set<Effect> = new Set();
  _fallback = false;
  _signal = new Computation(false, null);
  run(type: number) {
    if (type && this._fallback) return;
    super.run(type);
  }
  _update(node: Effect) {
    if (node._stateFlags & LOADING_BIT) {
      this._nodes.add(node);
      if (!this._fallback) {
        this._fallback = true;
        queueMicrotask(() => this._signal.write(true));
      }
    } else {
      this._nodes.delete(node);
      if (this._nodes.size === 0) {
        this._fallback = false;
        queueMicrotask(() => this._signal.write(false));
      }
    }
  }
}

export function createSuspense(fn: () => any, fallbackFn: () => any) {
  const queue = new SuspenseQueue();
  const tree = createBoundary(fn, queue);
  const equality = new Computation(null, () => queue._signal.read() || queue._fallback);
  const comp = new Computation(null, () => (equality.read() ? untrack(fallbackFn) : tree));
  return comp.read.bind(comp);
}
