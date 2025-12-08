import { recompute } from "./core/core.js";
import {
  computed,
  createOwner,
  NotReadyError,
  onCleanup,
  Queue,
  read,
  runWithOwner,
  setSignal,
  signal,
  staleValues,
  StatusFlags,
  untrack,
  type Computed,
  type Effect,
  type Owner
} from "./core/index.js";
import type { IQueue, QueueCallback, Signal } from "./core/index.js";

export interface BoundaryComputed<T> extends Computed<T> {
  _propagationMask: number;
}

function boundaryComputed<T>(fn: () => T, propagationMask: number): BoundaryComputed<T> {
  const node = computed<T>(fn, undefined, {
    _internal: {
      _notifyQueue(this: BoundaryComputed<T>) {
        let flags = this._statusFlags;
        this._statusFlags &= ~this._propagationMask;
        if (
          this._propagationMask & StatusFlags.Pending &&
          !((this._statusFlags & StatusFlags.Uninitialized) /*|| ActiveTransition*/)
        ) {
          flags &= ~StatusFlags.Pending;
        }
        this._queue.notify(this as any, this._propagationMask, flags);
      },
      _propagationMask: propagationMask
    }
  } as any) as BoundaryComputed<T>;
  node._propagationMask = propagationMask;
  return node;
}

function createBoundChildren<T>(
  owner: Owner,
  fn: () => T,
  queue: IQueue,
  mask: number
): Computed<T> {
  const parentQueue = owner._queue;
  parentQueue.addChild((owner._queue = queue));
  onCleanup(() => parentQueue.removeChild(owner._queue!));
  return runWithOwner(owner, () => {
    const c = computed(fn);
    return boundaryComputed(() => staleValues(() => flatten(read(c))), mask);
  });
}

class ConditionalQueue extends Queue {
  _disabled: Signal<boolean>;
  _errorNodes: Set<Effect<any>> = new Set();
  _pendingNodes: Set<Effect<any>> = new Set();
  constructor(disabled: Signal<boolean>) {
    super();
    this._disabled = disabled;
  }
  run(type: number) {
    if (!type || read(this._disabled)) return;
    return super.run(type);
  }
  notify(node: Effect<any>, type: number, flags: number) {
    if (read(this._disabled)) {
      if (type & StatusFlags.Pending) {
        if (flags & StatusFlags.Pending) {
          this._pendingNodes.add(node);
          type &= ~StatusFlags.Pending;
        } else if (this._pendingNodes.delete(node)) type &= ~StatusFlags.Pending;
      }
      if (type & StatusFlags.Error) {
        if (flags & StatusFlags.Error) {
          this._errorNodes.add(node);
          type &= ~StatusFlags.Error;
        } else if (this._errorNodes.delete(node)) type &= ~StatusFlags.Error;
      }
    }
    return type ? super.notify(node, type, flags) : true;
  }
}

export class CollectionQueue extends Queue {
  _collectionType: number;
  _nodes: Set<Effect<any>> = new Set();
  _disabled: Signal<boolean> = signal(false, { pureWrite: true });
  _initialized: boolean = false;
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  run(type: number) {
    if (!type || read(this._disabled)) return;
    return super.run(type);
  }
  enqueue(type: number, fn: QueueCallback): void {
    if (this._collectionType & StatusFlags.Pending && this._initialized) {
      return this._parent?.enqueue(type, fn);
    }
    return super.enqueue(type, fn);
  }
  notify(node: Effect<any>, type: number, flags: number) {
    if (
      !(type & this._collectionType) ||
      (this._collectionType & StatusFlags.Pending && this._initialized)
    )
      return super.notify(node, type, flags);
    if (flags & this._collectionType) {
      this._nodes.add(node);
      if (this._nodes.size === 1) setSignal(this._disabled, true);
    } else if (this._nodes.size > 0) {
      this._nodes.delete(node);
      if (this._nodes.size === 0) setSignal(this._disabled, false);
    }
    type &= ~this._collectionType;
    return type ? super.notify(node, type, flags) : true;
  }
}

export enum BoundaryMode {
  VISIBLE = "visible",
  HIDDEN = "hidden"
}
export function createBoundary<T>(fn: () => T, condition: () => BoundaryMode) {
  const owner = createOwner();
  const queue = new ConditionalQueue(computed(() => condition() === BoundaryMode.HIDDEN));
  const tree = createBoundChildren(owner, fn, queue, 0);
  computed(() => {
    const disabled = read(queue._disabled);
    (tree as BoundaryComputed<any>)._propagationMask = disabled
      ? StatusFlags.Error | StatusFlags.Pending
      : 0;
    if (!disabled) {
      queue._pendingNodes.forEach(node =>
        queue.notify(node, StatusFlags.Pending, StatusFlags.Pending)
      );
      queue._errorNodes.forEach(node => queue.notify(node, StatusFlags.Error, StatusFlags.Error));
      queue._pendingNodes.clear();
      queue._errorNodes.clear();
    }
  });
  return () => (read(queue._disabled) ? undefined : read(tree));
}

function createCollectionBoundary<T>(
  type: number,
  fn: () => any,
  fallback: (queue: CollectionQueue) => any
) {
  const owner = createOwner();
  const queue = new CollectionQueue(type);
  const tree = createBoundChildren(owner, fn, queue, type);
  const decision = computed(() => {
    if (!read(queue._disabled)) {
      const resolved = read(tree);
      if (!untrack(() => read(queue._disabled))) queue._initialized = true;
      return resolved;
    }
    return fallback(queue);
  });
  return read.bind(null, decision);
}

export function createLoadBoundary(fn: () => any, fallback: () => any) {
  return createCollectionBoundary(StatusFlags.Pending, fn, () => fallback());
}

export function createErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
) {
  return createCollectionBoundary(StatusFlags.Error, fn, queue => {
    let node = queue._nodes!.values().next().value!;
    return fallback(node._error, () => {
      // incrementClock();
      for (let node of queue._nodes) {
        recompute(node as Computed<unknown>, true);
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
