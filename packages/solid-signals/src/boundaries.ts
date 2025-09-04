import {
  ActiveTransition,
  Computation,
  compute,
  EagerComputation,
  ERROR_BIT,
  incrementClock,
  LOADING_BIT,
  NotReadyError,
  onCleanup,
  Owner,
  Queue,
  STATE_DIRTY,
  UNCHANGED,
  UNINITIALIZED_BIT
} from "./core/index.js";
import type { Effect, IQueue } from "./core/index.js";

class BoundaryComputation<T> extends EagerComputation<T | undefined> {
  _propagationMask: number;
  constructor(compute: () => T, propagationMask: number) {
    super(undefined as any, compute, { defer: true });
    this._propagationMask = propagationMask;
  }
  write(value: T | UNCHANGED, flags: number) {
    super.write(value, flags & ~this._propagationMask);
    if (this._propagationMask & LOADING_BIT && !(this._stateFlags & UNINITIALIZED_BIT)) {
      flags &= ~LOADING_BIT;
    }
    this._queue.notify(this as any, this._propagationMask, flags);
    return this._value;
  }
}

function createBoundChildren<T>(
  owner: Owner,
  fn: () => T,
  queue: IQueue,
  mask: number
): Computation<T> {
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
    if (!type || this._disabled.read()) return;
    return super.run(type);
  }
  notify(node: Effect, type: number, flags: number) {
    if (ActiveTransition && ActiveTransition._clonedQueues.has(this))
      return ActiveTransition._clonedQueues.get(this)!.notify(node, type, flags);
    if (this._disabled.read()) {
      if (type & LOADING_BIT) {
        if (flags & LOADING_BIT) {
          this._pendingNodes.add(node);
          type &= ~LOADING_BIT;
        } else if (this._pendingNodes.delete(node)) type &= ~LOADING_BIT;
      }
      if (type & ERROR_BIT) {
        if (flags & ERROR_BIT) {
          this._errorNodes.add(node);
          type &= ~ERROR_BIT;
        } else if (this._errorNodes.delete(node)) type &= ~ERROR_BIT;
      }
    }
    return type ? super.notify(node, type, flags) : true;
  }
  merge(queue: ConditionalQueue): void {
    queue._pendingNodes.forEach(n => this.notify(n, LOADING_BIT, LOADING_BIT));
    queue._errorNodes.forEach(n => this.notify(n, ERROR_BIT, ERROR_BIT));
    super.merge(queue);
  }
}

export class CollectionQueue extends Queue {
  _collectionType: number;
  _nodes: Set<Effect> = new Set();
  _disabled: Computation<boolean> = new Computation(false, null, { pureWrite: true });
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  run(type: number) {
    if (!type || this._disabled.read()) return;
    return super.run(type);
  }
  notify(node: Effect, type: number, flags: number) {
    if (ActiveTransition && ActiveTransition._clonedQueues.has(this))
      return ActiveTransition._clonedQueues.get(this)!.notify(node, type, flags);
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
  merge(queue: CollectionQueue): void {
    queue._nodes.forEach(n => this.notify(n, this._collectionType, this._collectionType));
    super.merge(queue);
  }
}

export enum BoundaryMode {
  VISIBLE = "visible",
  HIDDEN = "hidden"
}
export function createBoundary<T>(fn: () => T, condition: () => BoundaryMode) {
  const owner = new Owner();
  const queue = new ConditionalQueue(
    new Computation(undefined, () => condition() === BoundaryMode.HIDDEN)
  );
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
  return () => (queue._disabled.read() ? undefined : tree.read());
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
  return createCollectionBoundary(ERROR_BIT, fn, queue => {
    let node = queue._nodes!.values().next().value!;
    ActiveTransition && ActiveTransition._sources.has(node) && (node = ActiveTransition._sources.get(node)! as Effect);
    return fallback(node._error, () => {
      incrementClock();
      for (let node of queue._nodes) {
        (node as any)._state = STATE_DIRTY;
        (node as any)._queue?.enqueue((node as any)._type, node._run.bind(node));
      }
    });
  });
}

export function flatten(
  children: any,
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): any {
  if (typeof children === "function" && !children.length) {
    if (options?.doNotUnwrap) return children;
    do {
      children = children();
    } while (typeof children === "function" && !children.length);
  }
  if (
    options?.skipNonRendered &&
    (children == null || children === true || children === false || children === "")
  )
    return;

  if (Array.isArray(children)) {
    let results: any[] = [];
    if (flattenArray(children, results, options)) {
      return () => {
        let nested = [];
        flattenArray(results, nested, { ...options, doNotUnwrap: false });
        return nested;
      };
    }
    return results;
  }
  return children;
}

function flattenArray(
  children: Array<any>,
  results: any[] = [],
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): boolean {
  let notReady: NotReadyError | null = null;
  let needsUnwrap = false;
  for (let i = 0; i < children.length; i++) {
    try {
      let child = children[i];
      if (typeof child === "function" && !child.length) {
        if (options?.doNotUnwrap) {
          results.push(child);
          needsUnwrap = true;
          continue;
        }
        do {
          child = child();
        } while (typeof child === "function" && !child.length);
      }
      if (Array.isArray(child)) {
        needsUnwrap = flattenArray(child, results, options);
      } else if (
        options?.skipNonRendered &&
        (child == null || child === true || child === false || child === "")
      ) {
        // skip
      } else results.push(child);
    } catch (e) {
      if (!(e instanceof NotReadyError)) throw e;
      notReady = e;
    }
  }
  if (notReady) throw notReady;
  return needsUnwrap;
}
