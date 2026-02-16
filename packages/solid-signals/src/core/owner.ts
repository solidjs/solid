import {
  defaultContext,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_ZOMBIE
} from "./constants.js";
import { context, pendingCheckActive, pendingReadActive, runWithOwner, tracking } from "./core.js";
import { leafEffectActive } from "./effect.js";
import { unlinkSubs } from "./graph.js";
import { deleteFromHeap, insertIntoHeap } from "./heap.js";
import { dirtyQueue, globalQueue, zombieQueue } from "./scheduler.js";
import type { Computed, Disposable, Owner, Root } from "./types.js";

const PENDING_OWNER = {} as Owner; // Dummy owner to trigger store's read() path

export function markDisposal(el: Owner): void {
  let child = el._firstChild;
  while (child) {
    (child as Computed<unknown>)._flags |= REACTIVE_ZOMBIE;
    if ((child as Computed<unknown>)._flags & REACTIVE_IN_HEAP) {
      deleteFromHeap(child as Computed<unknown>, dirtyQueue);
      insertIntoHeap(child as Computed<unknown>, zombieQueue);
    }
    markDisposal(child);
    child = child._nextSibling;
  }
}

export function dispose(node: Computed<unknown>): void {
  let toRemove = node._deps || null;
  do {
    toRemove = unlinkSubs(toRemove!);
  } while (toRemove !== null);
  node._deps = null;
  node._depsTail = null;
  disposeChildren(node, true);
}

export function disposeChildren(node: Owner, self: boolean = false, zombie?: boolean): void {
  if ((node as any)._flags & REACTIVE_DISPOSED) return;
  if (self) (node as any)._flags = REACTIVE_DISPOSED;
  let child = zombie ? (node._pendingFirstChild as Owner) : node._firstChild;
  while (child) {
    const nextChild = child._nextSibling;
    if ((child as Computed<unknown>)._deps) {
      const n = child as Computed<unknown>;
      deleteFromHeap(n, n._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      let toRemove = n._deps;
      do {
        toRemove = unlinkSubs(toRemove!);
      } while (toRemove !== null);
      n._deps = null;
      n._depsTail = null;
    }
    disposeChildren(child, true);
    child = nextChild;
  }
  if (zombie) {
    node._pendingFirstChild = null;
  } else {
    node._firstChild = null;
    node._nextSibling = null;
    node._childCount = 0;
  }
  runDisposal(node, zombie);
}

function runDisposal(node: Owner, zombie?: boolean): void {
  let disposal = zombie ? node._pendingDisposal : node._disposal;
  if (!disposal) return;

  if (Array.isArray(disposal)) {
    for (let i = 0; i < disposal.length; i++) {
      const callable = disposal[i];
      callable.call(callable);
    }
  } else {
    (disposal as Disposable).call(disposal);
  }
  zombie ? (node._pendingDisposal = null) : (node._disposal = null);
}

export function getNextChildId(owner: Owner): string {
  let counter: Owner = owner;
  while (counter._transparent && counter._parent) counter = counter._parent;
  if (counter.id != null) return formatId(counter.id, counter._childCount++);
  throw new Error("Cannot get child id from owner without an id");
}

function formatId(prefix: string, id: number) {
  const num = id.toString(36),
    len = num.length - 1;
  return prefix + (len ? String.fromCharCode(64 + len) : "") + num;
}

export function getObserver(): Owner | null {
  if (pendingCheckActive || pendingReadActive) return PENDING_OWNER;
  return tracking ? context : null;
}

export function getOwner(): Owner | null {
  return context;
}

export function onCleanup(fn: Disposable): Disposable {
  if (!context) return fn;
  if (!context._disposal) context._disposal = fn;
  else if (Array.isArray(context._disposal)) context._disposal.push(fn);
  else context._disposal = [context._disposal, fn];
  return fn;
}

export function createOwner(options?: { id?: string; transparent?: boolean }) {
  const parent = context;
  const transparent = options?.transparent ?? false;
  const owner = {
    id:
      options?.id ??
      (transparent ? parent?.id : parent?.id != null ? getNextChildId(parent) : undefined),
    _transparent: transparent || undefined,
    _root: true,
    _parentComputed: (parent as Root)?._root ? (parent as Root)._parentComputed : parent,
    _firstChild: null,
    _nextSibling: null,
    _disposal: null,
    _queue: parent?._queue ?? globalQueue,
    _context: parent?._context || defaultContext,
    _childCount: 0,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _parent: parent,
    dispose(self: boolean = true) {
      disposeChildren(owner, self);
    }
  } as Root;

  if (__DEV__ && leafEffectActive && parent) {
    throw new Error("Cannot create reactive primitives inside createTrackedEffect");
  }
  if (parent) {
    const lastChild = parent._firstChild;
    if (lastChild === null) {
      parent._firstChild = owner;
    } else {
      owner._nextSibling = lastChild;
      parent._firstChild = owner;
    }
  }
  return owner;
}

/**
 * Creates a new non-tracked reactive context with manual disposal
 *
 * @param fn a function in which the reactive state is scoped
 * @returns the output of `fn`.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/create-root
 */
export function createRoot<T>(
  init: ((dispose: () => void) => T) | (() => T),
  options?: { id?: string; transparent?: boolean }
): T {
  const owner = createOwner(options);
  return runWithOwner(owner, () => init(owner.dispose));
}
