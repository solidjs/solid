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
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  untrack,
  type Computed,
  type Effect,
  type Owner
} from "./core/index.js";
import type { IQueue, Signal } from "./core/index.js";
import { schedule } from "./core/scheduler.js";

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
          this._propagationMask & STATUS_PENDING &&
          !((this._statusFlags & STATUS_UNINITIALIZED) /*|| ActiveTransition*/)
        ) {
          flags &= ~STATUS_PENDING;
        }
        this._queue.notify(this as any, this._propagationMask, flags);
      },
      _propagationMask: propagationMask
    }
  } as any) as BoundaryComputed<T>;
  node._propagationMask = propagationMask;
  (node as any)._preventAutoDisposal = true;
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
      if (type & STATUS_PENDING) {
        if (flags & STATUS_PENDING) {
          this._pendingNodes.add(node);
          type &= ~STATUS_PENDING;
        } else if (this._pendingNodes.delete(node)) type &= ~STATUS_PENDING;
      }
      if (type & STATUS_ERROR) {
        if (flags & STATUS_ERROR) {
          this._errorNodes.add(node);
          type &= ~STATUS_ERROR;
        } else if (this._errorNodes.delete(node)) type &= ~STATUS_ERROR;
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
  notify(node: Effect<any>, type: number, flags: number) {
    if (
      !(type & this._collectionType) ||
      (this._collectionType & STATUS_PENDING && this._initialized)
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

export const enum BoundaryMode {
  VISIBLE = "visible",
  HIDDEN = "hidden"
}
export function createBoundary<T>(fn: () => T, condition: () => BoundaryMode) {
  const owner = createOwner();
  const queue = new ConditionalQueue(computed(() => condition() === BoundaryMode.HIDDEN));
  const tree = createBoundChildren(owner, fn, queue, 0);
  computed(() => {
    const disabled = read(queue._disabled);
    (tree as BoundaryComputed<any>)._propagationMask = disabled ? STATUS_ERROR | STATUS_PENDING : 0;
    if (!disabled) {
      queue._pendingNodes.forEach(node => queue.notify(node, STATUS_PENDING, STATUS_PENDING));
      queue._errorNodes.forEach(node => queue.notify(node, STATUS_ERROR, STATUS_ERROR));
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
  return createCollectionBoundary(STATUS_PENDING, fn, () => fallback());
}

function collectErrorSources(node: Computed<any>, sources: Computed<any>[]) {
  let root = true;
  let dep = node._deps;
  while (dep !== null) {
    const source = dep._dep;
    if ((source as Computed<any>)._deps && source._statusFlags & STATUS_ERROR) {
      root = false;
      collectErrorSources(source as any, sources);
    }
    dep = dep._nextDep;
  }
  root && sources.push(node);
}

export function createErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
) {
  return createCollectionBoundary(STATUS_ERROR, fn, queue => {
    let node = queue._nodes!.values().next().value!;
    return fallback(node._error, () => {
      const sources: Computed<any>[] = [];
      for (const node of queue._nodes) collectErrorSources(node as any, sources);
      for (const source of sources) recompute(source);
      schedule();
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
