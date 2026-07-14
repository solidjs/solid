import {
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_TRANSPARENT,
  defaultContext,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_IN_HEAP_HEIGHT,
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
import { deleteFromHeap, insertIntoHeap, insertIntoHeapHeight } from "./heap.js";
import { dirtyQueue, GlobalQueue, globalQueue, zombieQueue } from "./scheduler.js";
import type { Computed, Disposable, Owner, Root } from "./types.js";

const PENDING_OWNER = {} as Owner; // Dummy owner to trigger store's read() path

export function markDisposal(el: Owner): void {
  let child = el._firstChild;
  while (child) {
    const flags = (child as Computed<unknown>)._flags;
    (child as Computed<unknown>)._flags = flags | REACTIVE_ZOMBIE;
    // migrate height-adjust entries too, not just recompute entries: every
    // `deleteFromHeap` call site picks the queue from the zombie flag, so a
    // node left physically linked in `dirtyQueue` after being zombified gets
    // unlinked from the wrong queue on dispose, corrupting the bucket and
    // livelocking the next `runHeap` that reaches it (#2759)
    if (flags & (REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT)) {
      deleteFromHeap(
        child as Computed<unknown>,
        flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue
      );
      if (flags & REACTIVE_IN_HEAP) insertIntoHeap(child as Computed<unknown>, zombieQueue);
      else insertIntoHeapHeight(child as Computed<unknown>, zombieQueue);
    }
    markDisposal(child);
    child = child._nextSibling;
  }
}

export function dispose(node: Computed<unknown>): void {
  let toRemove = node._deps;
  while (toRemove !== null) {
    toRemove = unlinkSubs(toRemove);
  }
  node._deps = null;
  node._depsTail = null;
  disposeChildren(node, true);
}

export function disposeChildren(node: Owner, self: boolean = false, zombie?: boolean): void {
  const flags = (node as any)._flags;
  if (flags & REACTIVE_DISPOSED) return;
  if (self) {
    (node as any)._flags = flags | REACTIVE_DISPOSED;
    // Companions are created detached and outlive their owner, but a verdict
    // must not: a disposed source can never settle, so an isPending companion
    // latched `true` here would hold a spinner forever (INV-9, the PR #2845
    // edge). Snap runs after the DISPOSED flag is set so the oracle reads
    // false, and notifies subscribers still watching the companion.
    const n = node as Computed<unknown>;
    if (n._pendingSignal || n._latestValueComputed) GlobalQueue._snapCompanions!(n);
  }
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
  // O(1) splice out of parent's chain on individual dispose. Skipped during
  // batch dispose (parent already disposed) and zombie disposal (node sits on
  // parent's _pendingFirstChild). We leave node._nextSibling intact so outer
  // walks that already advanced past us still reach later siblings.
  if (
    self &&
    !zombie &&
    !(flags & REACTIVE_ZOMBIE) &&
    node._parent !== null &&
    !((node._parent as any)._flags & REACTIVE_DISPOSED)
  ) {
    const prev = node._prevSibling;
    const next = node._nextSibling;
    if (prev !== null) prev._nextSibling = next;
    else node._parent._firstChild = next;
    if (next !== null) next._prevSibling = prev;
    node._prevSibling = null;
  }
  runDisposal(node, zombie);
  // Final effect-returned cleanup fires at true disposal, after `_disposal`
  // to mirror rerun ordering (compute-phase teardown first, cleanup last).
  if (self && node._cleanup) {
    const effectCleanup = node._cleanup;
    node._cleanup = undefined;
    effectCleanup();
  }
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

/**
 * Allocates and returns the next stable child id for `owner`. Used by
 * hydration plumbing and `createUniqueId`. Not part of the user-facing API.
 *
 * @internal
 */
export function getNextChildId(owner: Owner): string {
  return childId(owner, true);
}

/**
 * Returns the *next* child id for `owner` without consuming it. Used by
 * hydration plumbing to peek at the id a future child will receive.
 *
 * @internal
 */
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
 *
 * @example
 * ```ts
 * // Library predicate: only register a hot-path subscription when the
 * // caller is inside a tracking scope (memo / effect compute / JSX).
 * function trackIfTracked(source: () => unknown) {
 *   if (getObserver()) source();
 * }
 * ```
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

/**
 * Returns `true` if the owner has been disposed (or marked zombie pending
 * disposal). Pair with a captured owner to bail out of late callbacks whose
 * surrounding component already unmounted.
 *
 * @example
 * ```ts
 * function onSettleSafe(fn: () => void) {
 *   const owner = getOwner();
 *   queueMicrotask(() => {
 *     if (owner && isDisposed(owner)) return; // component unmounted; skip
 *     runWithOwner(owner, fn);
 *   });
 * }
 * ```
 */
export function isDisposed(node: Owner): boolean {
  return !!((node as any)._flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE));
}

function disposeRootSelf(this: Root, self: boolean = true): void {
  disposeChildren(this, self);
}

/**
 * Creates a fresh owner attached as a child of the current owner (or as a
 * detached root if there is none). Used by framework internals to group
 * cleanups; app code should use `createRoot()` (host a reactive scope outside
 * a component) or `runWithOwner()` (re-enter a captured owner).
 *
 * @internal
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
    _prevSibling: null,
    _disposal: null,
    _queue: parent?._queue ?? globalQueue,
    _context: parent?._context || defaultContext,
    _childCount: 0,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _parent: parent,
    dispose: disposeRootSelf
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
      lastChild._prevSibling = owner;
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
  return runWithOwner(owner, () => init(() => owner.dispose()));
}
