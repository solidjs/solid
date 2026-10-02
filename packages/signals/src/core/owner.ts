import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_HELD,
  CONFIG_TRANSPARENT,
  defaultContext,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_ZOMBIE,
  STATUS_PENDING
} from "./constants.js";
import {
  assertNotInEffectCallback,
  context,
  enterDisposal,
  exitDisposal,
  PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE,
  runWithOwner,
  tracking
} from "./core.js";
import {
  assertInvariant,
  clearSignals,
  DEV,
  emitDiagnostic,
  registerRoot,
  unregisterRoot
} from "./dev.js";
import { clearDeps, unobserved } from "./graph.js";
import { deleteFromHeap } from "./heap.js";
import { dirtyQueue, schedule } from "./scheduler.js";
import type { Computed, Disposable, Owner, Root } from "./types.js";

// L2 (step 2): the parked frame. A pass parks the previous frame's children
// and `_disposal` list on `_x._pendingFirstChild` / `_x._pendingDisposal`
// (`parkChildren`, core.ts); they keep reacting until the node's commit
// disposes them (`zombie` walk below) or the owner dies. `markDisposal` flags
// the parked subtree REACTIVE_ZOMBIE: the splice guard and the reawaken path
// key off it, and the heap defers a zombie's recompute past the seam (no
// second heap — the deferral list in scheduler.ts).

export function markDisposal(el: Owner): void {
  let child = el._firstChild;
  while (child) {
    (child as Computed<unknown>)._flags |= REACTIVE_ZOMBIE;
    markDisposal(child);
    child = child._nextSibling;
  }
}

export function dispose(node: Computed<unknown>): void {
  // Direct disposal is death, not dormancy: strip the observation lifecycle
  // so a later read freezes at the last committed value instead of
  // reawakening the node (#3024). The teardown itself (heap removal — a node
  // left queued would be recomputed and resurrected by the next flush (#2983)
  // — dep unlinking, child disposal) is exactly unobserved()'s body; only
  // this flag distinguishes death from dormancy.
  node._config &= ~CONFIG_AUTO_DISPOSE;
  unobserved(node);
}

export function disposeChildren(node: Owner, self: boolean = false, zombie?: boolean): void {
  const flags = (node as any)._flags;
  if (flags & REACTIVE_DISPOSED) return;
  // A parked frame dies with its owner (#3024): the commit that would retire
  // it never comes once the node is DISPOSED, so it drains here or its
  // cleanups never run and it stays subscribed, rerunning in a torn-down
  // tree (#3561). Death only (`self`): a re-pass leaves the frame reacting
  // until the commit.
  if (
    self &&
    !zombie &&
    node._x !== null &&
    (node._x._pendingFirstChild !== null || node._x._pendingDisposal !== null)
  )
    disposeChildren(node, false, true);
  if (self) {
    (node as any)._flags = flags | REACTIVE_DISPOSED;
    if (__OBSERVE__ && node._parent === null && (node as Root)._root) unregisterRoot(node);
  }
  if (self && __DEV__) clearSignals(node);
  if (self && (node as any)._fn) {
    if ((node as Computed<unknown>)._x !== null) (node as Computed<unknown>)._x!._inFlight = null;
    // A death that can unblock the future (L2, `futureBlocked`): a held
    // flight's, or a stale reader's (REACTIVE_FRAME_READ — a frame that
    // derived from one). Nothing else re-examines a dead node, so make sure
    // a seam comes.
    if (
      ((node as Computed<unknown>)._statusFlags & STATUS_PENDING && node._config & CONFIG_HELD) ||
      flags & REACTIVE_FRAME_READ
    )
      schedule();
  }
  let child = zombie ? node._x!._pendingFirstChild : node._firstChild;
  if (zombie) node._x!._pendingFirstChild = null;
  else node._firstChild = null;
  while (child) {
    const n = child as Computed<unknown>;
    // Owner teardown is death regardless of the child's own lifecycle
    // (#3024): strip AUTO_DISPOSE so a post-disposal read freezes at the
    // last committed value instead of reawakening in a torn-down tree.
    // Runs before the recursion so already-dormant children (whose
    // disposeChildren call early-returns on REACTIVE_DISPOSED) die too.
    // Only unobserved()'s own node keeps its dormancy — it is never in
    // this loop; its children are rebuilt fresh on reawaken.
    n._config &= ~CONFIG_AUTO_DISPOSE;
    // Heap removal must not be gated on `_deps`: a dependency-free
    // computation queued by refresh() has a null dep list but still sits in
    // the dirty heap, and left there the post-disposal flush recomputes it —
    // recompute() rewriting `_flags` clears REACTIVE_DISPOSED and the node
    // comes back to life (post-unmount runs, leaked cleanups, #2983).
    // deleteFromHeap self-guards on the in-heap flags (and tolerates plain
    // Owners, whose _flags is undefined), so no gate here.
    deleteFromHeap(n, dirtyQueue);
    clearDeps(n);
    // The chain is detached above so a node a cleanup links mid-drain lands
    // on the fresh head and survives. Pointing each drained child's prev at
    // itself routes its later splice onto the detached chain, never the head,
    // and keeps the dev owner-chain-head invariant honest for those children.
    child._prevSibling = child;
    disposeChildren(child, true);
    // Read after, not before: a sibling this disposal made dormant spliced
    // itself out of the detached chain, and a cleanup may then have linked
    // it at the fresh head, which rewrote the `_nextSibling` a pre-read
    // would still be holding.
    child = child._nextSibling;
  }
  if (!zombie) node._childCount = 0;
  // O(1) splice out of parent's chain on individual dispose. Skipped during
  // batch dispose (parent already disposed) and for a zombie (it sits on the
  // parent's parked frame, drained whole by the commit). We leave
  // node._nextSibling intact so outer walks that already advanced past us
  // still reach later siblings.
  if (
    self &&
    !zombie &&
    !(flags & REACTIVE_ZOMBIE) &&
    node._parent !== null &&
    !((node._parent as any)._flags & REACTIVE_DISPOSED)
  ) {
    const prev = node._prevSibling;
    const next = node._nextSibling;
    // A node with no predecessor must be the chain's head; otherwise the
    // write below would clobber the head with a stale `_nextSibling`,
    // orphaning every live child ahead of it (#3543).
    if (__DEV__)
      assertInvariant(
        prev !== null || node._parent._firstChild === node,
        "owner-chain-head",
        "head node is not parent._firstChild — a node was spliced while flagged live but not in the chain (see #3543)"
      );
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
    if (__DEV__) enterDisposal();
    effectCleanup();
    if (__DEV__) exitDisposal();
  }
}

export function linkChild(parent: Owner, node: Owner): void {
  const head = parent._firstChild;
  node._prevSibling = null;
  node._nextSibling = head;
  if (head !== null) head._prevSibling = node;
  parent._firstChild = node;
}

function runDisposal(node: Owner, zombie?: boolean): void {
  // Detach the list BEFORE running it (#3601), as `_cleanup` is (#2813). A
  // cleanup that disposes an ancestor re-enters this node through the death
  // walk while the loop is still running; with the list still attached, that
  // walk ran every entry a second time. Detached, the re-entrant drain finds
  // nothing. The same shape latched a throwing cleanup: the list survived the
  // throw and every later drain re-ran and re-threw it.
  const disposal = zombie ? node._x!._pendingDisposal : node._disposal;
  if (!disposal) return;
  if (zombie) node._x!._pendingDisposal = null;
  else node._disposal = null;

  // No try/finally: it would survive into prod (rollup keeps the frame). A
  // throw leaves the depth raised; dev.ts clears the stale count on the next
  // microtask, since teardown never spans one (core.ts).
  if (__DEV__) enterDisposal();
  if (Array.isArray(disposal)) {
    // Unwind order (#3572, restores 1.x #1562): later registrations run
    // before earlier ones. Children have already been disposed by the caller,
    // so with LIFO a body that registers cleanup before creating its children
    // tears down after them — the same order a per-component owner gives.
    for (let i = disposal.length - 1; i >= 0; i--) {
      const callable = disposal[i];
      callable.call(callable);
    }
  } else {
    disposal.call(disposal);
  }
  if (__DEV__) exitDisposal();
}

function childId(owner: Owner, consume: boolean): string {
  let counter: Owner = owner;
  while (counter._config & CONFIG_TRANSPARENT && counter._parent) counter = counter._parent;
  if (counter.id != null)
    return formatId(counter.id, consume ? counter._childCount++ : counter._childCount);
  throw new Error(__DEV__ ? "Cannot get child id from owner without an id" : "");
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
 * The id a freshly-created node inherits: an explicit `options.id` wins;
 * transparent nodes share their parent's id; otherwise the parent's next
 * child id is consumed (or `undefined` outside an id-carrying tree).
 */
export function inheritId(
  options: { id?: string } | undefined,
  transparent: boolean,
  parent: Owner | null | undefined
): string | undefined {
  return (
    options?.id ??
    (transparent ? parent?.id : parent?.id != null ? getNextChildId(parent) : undefined)
  );
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
 * Returns `true` if the owner has been disposed. Pair with a captured owner
 * to bail out of late callbacks whose surrounding component already
 * unmounted.
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
  return !!((node as any)._flags & REACTIVE_DISPOSED);
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
  // Prod and observe boilerplates (see core.ts computed()). The observe
  // literal carries the `_name` slot the rendering layer fills with the
  // component label (`owner._name = "<App>"`) — a slot, so labelling a root
  // is a plain store rather than a shape fork between labelled and plain roots.
  const owner = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, parent),
        _config: transparent ? CONFIG_TRANSPARENT : 0,
        _root: true,
        _parentComputed: (parent as Root)?._root ? (parent as Root)._parentComputed : parent,
        _firstChild: null,
        _nextSibling: null,
        _prevSibling: null,
        _disposal: null,
        _context: parent?._context || defaultContext,
        _childCount: 0,
        _x: null,
        _parent: parent,
        dispose: disposeRootSelf,
        _name: undefined as string | undefined
      } as Root)
    : ({
        id: inheritId(options, transparent, parent),
        _config: transparent ? CONFIG_TRANSPARENT : 0,
        _root: true,
        _parentComputed: (parent as Root)?._root ? (parent as Root)._parentComputed : parent,
        _firstChild: null,
        _nextSibling: null,
        _prevSibling: null,
        _disposal: null,
        _context: parent?._context || defaultContext,
        _childCount: 0,
        _x: null,
        _parent: parent,
        dispose: disposeRootSelf
      } as Root);

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
  if (__DEV__) assertNotInEffectCallback();
  if (parent) linkChild(parent, owner);
  else if (__OBSERVE__) registerRoot(owner);
  if (__DEV__) DEV.hooks.onOwner?.(owner);
  return owner;
}

/**
 * Creates a reactive root — an owner scope with its own `dispose()`. A root
 * created inside an existing owner is owned by it and is disposed when the
 * parent is disposed; call `dispose()` to tear it down earlier. To create a
 * root that outlives its creator, detach explicitly:
 * `runWithOwner(null, () => createRoot(...))`. Pass `id` to seed hydration
 * ids for the tree it owns.
 *
 * `dispose()` tears down every signal, memo, effect, and `onCleanup`
 * registered inside the root.
 *
 * Use this to host long-lived reactive scopes outside of a component (custom
 * controllers, app bootstrapping, tests). Inside a component, prefer
 * letting Solid's component lifecycle own things.
 *
 * @example
 * ```ts
 * // At module level there is no owner, so this root lives until disposed.
 * const dispose = createRoot(dispose => {
 *   const [n, setN] = createSignal(0);
 *   createEffect(() => n(), value => console.log(value));
 *   setInterval(() => setN(x => x + 1), 1000);
 *   return dispose;
 * });
 *
 * // Later, to tear everything down:
 * dispose();
 *
 * // Inside an owner (component, effect, another root), detach explicitly
 * // if the root must outlive its creator:
 * const detached = runWithOwner(null, () => createRoot(d => d));
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
