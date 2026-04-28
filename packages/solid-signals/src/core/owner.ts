import {
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_TRANSPARENT,
  defaultContext,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_ZOMBIE
} from "./constants.js";
import {
  context,
  latestReadActive,
  pendingCheckActive,
  PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE,
  runWithOwner,
  tracking
} from "./core.js";
import { clearSignals, DEV, emitDiagnostic } from "./dev.js";
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
  if (self && __DEV__) clearSignals(node);
  if (self && (node as any)._fn) (node as Computed<unknown>)._inFlight = null;
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

function childId(owner: Owner, consume: boolean): string {
  let counter: Owner = owner;
  while (counter._config & CONFIG_TRANSPARENT && counter._parent) counter = counter._parent;
  if (counter.id != null)
    return formatId(counter.id, consume ? counter._childCount++ : counter._childCount);
  throw new Error("Cannot get child id from owner without an id");
}

export function getNextChildId(owner: Owner): string {
  return childId(owner, true);
}

export function peekNextChildId(owner: Owner): string {
  return childId(owner, false);
}

function formatId(prefix: string, id: number) {
  const num = id.toString(36),
    len = num.length - 1;
  return prefix + (len ? String.fromCharCode(64 + len) : "") + num;
}

/**
 * Returns the currently-tracking observer (the computation that subscribes to
 * reactive reads at this point), or `null` if reads here would be untracked.
 * Used by reactive primitives that need to know whether they're inside a
 * tracking scope. App code rarely needs this — see `getOwner()` for the
 * lifecycle owner instead.
 */
export function getObserver(): Owner | null {
  if (pendingCheckActive || latestReadActive) return PENDING_OWNER;
  return tracking ? context : null;
}

/**
 * Returns the current reactive **owner** — the lifecycle node that the next
 * `cleanup()` / `onCleanup()` / `createSignal()` etc. will be attached to.
 *
 * Returns `null` if called outside any owner. Capture the owner with
 * `getOwner()` and re-enter it later with `runWithOwner(owner, fn)` to attach
 * disposables created from a callback (event handler, async resolution, etc.)
 * back to a component's lifecycle.
 *
 * @example
 * ```ts
 * function defer<T>(fn: () => T) {
 *   const owner = getOwner();
 *   queueMicrotask(() => runWithOwner(owner, fn));
 * }
 * ```
 */
export function getOwner(): Owner | null {
  return context;
}

/**
 * Low-level: registers `fn` as a disposal callback on the current owner.
 * Most code should use `onCleanup()` from `solid-js`, which adds dev-mode
 * checks. `cleanup()` is the unchecked primitive used by internals.
 */
export function cleanup(fn: Disposable): Disposable {
  if (!context) return fn;
  if (!context._disposal) context._disposal = fn;
  else if (Array.isArray(context._disposal)) context._disposal.push(fn);
  else context._disposal = [context._disposal, fn];
  return fn;
}

/** Returns `true` if the owner has been disposed (or marked zombie pending disposal). */
export function isDisposed(node: Owner): boolean {
  return !!((node as any)._flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE));
}

/**
 * Creates a fresh owner attached as a child of the current owner (or as a
 * detached root if there is none). Mostly used by framework internals to
 * group cleanups; app code should prefer `createRoot()` or `runWithOwner()`.
 */
export function createOwner(options?: { id?: string; transparent?: boolean }) {
  const parent = context;
  const transparent = options?.transparent ?? false;
  const owner = {
    id:
      options?.id ??
      (transparent ? parent?.id : parent?.id != null ? getNextChildId(parent) : undefined),
    _config: transparent ? CONFIG_TRANSPARENT : 0,
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

  if (__DEV__ && parent && parent._config & CONFIG_CHILDREN_FORBIDDEN) {
    emitDiagnostic({
      code: "PRIMITIVE_IN_FORBIDDEN_SCOPE",
      kind: "lifecycle",
      severity: "error",
      message: PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE,
      ownerId: parent.id,
      ownerName: (parent as any)._name
    });
    throw new Error(PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE);
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
  if (__DEV__) DEV.hooks.onOwner?.(owner);
  return owner;
}

/**
 * Creates a detached reactive root. The callback receives a `dispose()`
 * function which, when called, tears down every signal, memo, effect, and
 * `onCleanup` registered inside the root.
 *
 * Use this to host long-lived reactive scopes outside of a component (custom
 * controllers, app bootstrapping, tests). Inside a component, prefer
 * letting Solid's component lifecycle own things.
 *
 * @example
 * ```ts
 * const dispose = createRoot(dispose => {
 *   const [n, setN] = createSignal(0);
 *   createEffect(() => n(), value => console.log(value));
 *   setInterval(() => setN(x => x + 1), 1000);
 *   return dispose;
 * });
 *
 * // Later, to tear everything down:
 * dispose();
 * ```
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
