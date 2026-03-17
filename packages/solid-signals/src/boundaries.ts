import { recompute } from "./core/core.js";
import type { StatusError } from "./core/error.js";
import {
  computed,
  createOwner,
  getOwner,
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
  untrack,
  type Computed,
  type Effect,
  type Owner
} from "./core/index.js";
import type { IQueue, Signal } from "./core/index.js";
import { schedule } from "./core/scheduler.js";
import { accessor } from "./signals.js";

export interface BoundaryComputed<T> extends Computed<T> {
  _propagationMask: number;
}

function boundaryComputed<T>(fn: () => T, propagationMask: number): BoundaryComputed<T> {
  const node = computed<T>(fn, undefined, { lazy: true }) as BoundaryComputed<T>;
  node._notifyStatus = (status?: number, error?: any) => {
    // Use passed values if provided, otherwise read from node
    const flags = status !== undefined ? status : node._statusFlags;
    const actualError = error !== undefined ? error : node._error;
    node._statusFlags &= ~node._propagationMask;
    node._queue.notify(node, node._propagationMask, flags, actualError);
  };
  node._propagationMask = propagationMask;
  (node as any)._preventAutoDisposal = true;
  recompute(node, true);
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

const ON_INIT: unique symbol = Symbol();

export class CollectionQueue extends Queue {
  _collectionType: number;
  _sources: Set<Computed<any>> = new Set();
  _disabled: Signal<boolean> = signal(false, { pureWrite: true, _noSnapshot: true });
  _initialized: boolean = false;
  _onFn: (() => any) | undefined;
  _prevOn: any = ON_INIT;
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  run(type: number) {
    if (!type || read(this._disabled)) return;
    return super.run(type);
  }
  notify(node: Effect<any>, type: number, flags: number, error?: any) {
    if (!(type & this._collectionType)) return super.notify(node, type, flags, error);

    if (this._initialized && this._onFn) {
      const currentOn = untrack(() => {
        try {
          return this._onFn!();
        } catch {
          return ON_INIT;
        }
      });
      if (currentOn !== this._prevOn) {
        this._prevOn = currentOn;
        this._initialized = false;
        this._sources.clear();
      }
    }

    if (this._collectionType & STATUS_PENDING && this._initialized)
      return super.notify(node, type, flags, error);

    if (flags & this._collectionType) {
      const source = (error as any)?.source || (node._error as any)?.source;
      if (source) {
        const wasEmpty = this._sources.size === 0;
        this._sources.add(source);
        if (wasEmpty) setSignal(this._disabled, true);
      }
    }
    type &= ~this._collectionType;
    return type ? super.notify(node, type, flags, error) : true;
  }
  checkSources() {
    for (const source of this._sources) {
      if (!(source._statusFlags & this._collectionType)) this._sources.delete(source);
    }
    if (!this._sources.size) {
      setSignal(this._disabled, false);
      if (this._onFn) {
        try {
          this._prevOn = untrack(() => this._onFn!());
        } catch {
          /* value not yet committed — _prevOn stays stale, next notify will reset */
        }
      }
    }
  }
}

function createCollectionBoundary<T>(
  type: number,
  fn: () => any,
  fallback: (queue: CollectionQueue) => any,
  onFn?: () => any
) {
  if (__DEV__ && !getOwner())
    console.warn("Boundaries created outside a reactive context will never be disposed.");
  const owner = createOwner();
  const queue = new CollectionQueue(type);
  if (onFn) queue._onFn = onFn;
  const tree = createBoundChildren(owner, fn, queue, type);
  const decision = computed(() => {
    if (!read(queue._disabled)) {
      const resolved = read(tree);
      if (!untrack(() => read(queue._disabled))) {
        queue._initialized = true;
        return resolved;
      }
    }
    return fallback(queue);
  });
  return accessor(decision);
}

export function createLoadingBoundary(
  fn: () => any,
  fallback: () => any,
  options?: { on?: () => any }
) {
  return createCollectionBoundary(STATUS_PENDING, fn, () => fallback(), options?.on);
}

export function createErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
) {
  return createCollectionBoundary(STATUS_ERROR, fn, queue => {
    let source = queue._sources!.values().next().value!;
    // Get the original error from StatusError if wrapped
    const error = (source._error as StatusError)?.cause ?? source._error;
    return fallback(error, () => {
      for (const source of queue._sources) recompute(source);
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
