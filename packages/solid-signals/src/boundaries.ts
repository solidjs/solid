import { recompute } from "./core/core.js";
import type { StatusError } from "./core/error.js";
import {
  cleanup,
  computed,
  createContext,
  createOwner,
  getContext,
  getOwner,
  NotReadyError,
  Queue,
  read,
  REACTIVE_DISPOSED,
  setContext,
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
import { emitDiagnostic } from "./core/dev.js";
import { schedule } from "./core/scheduler.js";
import { accessor } from "./signals.js";

export interface BoundaryComputed<T> extends Computed<T> {
  _propagationMask: number;
}

function boundaryComputed<T>(fn: () => T, propagationMask: number): BoundaryComputed<T> {
  const node = computed<T>(fn, { lazy: true }) as BoundaryComputed<T>;
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
  cleanup(() => parentQueue.removeChild(owner._queue!));
  return runWithOwner(owner, () => {
    const c = computed(fn);
    return boundaryComputed(() => staleValues(() => flatten(read(c))), mask);
  });
}

const ON_INIT: unique symbol = Symbol();
const RevealControllerContext = createContext<RevealController | null>(null);
let _revealUsed = false;

type RevealSlot = CollectionQueue | RevealController;
type BoolAccessor = () => boolean;
export type RevealOrder = "sequential" | "together" | "natural";
type OrderAccessor = () => RevealOrder;
const FALSE_ACCESSOR: BoolAccessor = () => false;
const SEQUENTIAL_ACCESSOR: OrderAccessor = () => "sequential";

function isRevealController(slot: RevealSlot): slot is RevealController {
  return slot instanceof RevealController;
}

function isSlotReady(slot: RevealSlot): boolean {
  return isRevealController(slot) ? slot.isReady() : slot._sources.size === 0 && !slot._pending;
}

function isSlotMinimallyReady(slot: RevealSlot): boolean {
  return isRevealController(slot) ? slot.isMinimallyReady() : isSlotReady(slot);
}

function setSlotState(
  slot: RevealSlot,
  controller: RevealController,
  disabled: boolean,
  collapsed: boolean
): void {
  setSignal(slot._disabled, disabled);
  setSignal(slot._collapsed, collapsed);
  if (isRevealController(slot)) {
    if (!disabled && slot._parentController === controller) slot._parentController = undefined;
    return slot.evaluate(disabled, collapsed);
  }
  if (!disabled && slot._revealController === controller && slot._initialized)
    slot._revealController = undefined;
}

export class RevealController {
  _orderAccessor: OrderAccessor;
  _collapsedAccessor: BoolAccessor;
  _slots: RevealSlot[] = [];
  _parentController?: RevealController;
  _disabled: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _collapsed: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _ready = true;
  _minimallyReady = true;
  _evaluating = false;

  constructor(order: OrderAccessor, collapsed: BoolAccessor) {
    this._orderAccessor = order;
    this._collapsedAccessor = collapsed;
  }

  _forEachOwnedSlot(fn: (slot: RevealSlot) => boolean | void): boolean {
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if ((isRevealController(slot) ? slot._parentController : slot._revealController) !== this)
        continue;
      if (fn(slot) === false) return false;
    }
    return true;
  }

  isReady(): boolean {
    return this._forEachOwnedSlot(isSlotReady);
  }

  /**
   * "Minimally ready" = this group has something visible to show under its own policy.
   * Used by an enclosing `together` group to decide when it can release.
   * - `together`: fully ready (atomic).
   * - `sequential`: the first owned slot is minimally ready (frontier can advance).
   * - `natural`: any owned slot is minimally ready.
   */
  isMinimallyReady(): boolean {
    const order = untrack(this._orderAccessor);
    if (order === "together") return this.isReady();
    if (order === "natural") {
      let hasSlot = false;
      let anyReady = false;
      this._forEachOwnedSlot(slot => {
        hasSlot = true;
        if (isSlotMinimallyReady(slot)) {
          anyReady = true;
          return false;
        }
      });
      return !hasSlot || anyReady;
    }
    // sequential: only the first owned slot matters.
    let firstReady = true;
    this._forEachOwnedSlot(slot => {
      firstReady = isSlotMinimallyReady(slot);
      return false;
    });
    return firstReady;
  }

  register(slot: RevealSlot): void {
    if (this._slots.includes(slot)) return;
    this._slots.push(slot);
    const order = untrack(this._orderAccessor);
    (setSignal(slot._disabled, true),
      setSignal(
        slot._collapsed,
        order === "sequential" ? !!untrack(this._collapsedAccessor) : false
      ));
    untrack(() => this.evaluate());
  }

  unregister(slot: RevealSlot): void {
    const index = this._slots.indexOf(slot);
    if (index >= 0) this._slots.splice(index, 1);
    untrack(() => this.evaluate());
  }

  evaluate(disabledOverride?: boolean, collapsedOverride?: boolean): void {
    if (this._evaluating) return;
    this._evaluating = true;
    const wasReady = this._ready;
    const wasMinReady = this._minimallyReady;
    try {
      const disabled = disabledOverride ?? read(this._disabled),
        order = untrack(this._orderAccessor),
        collapseTail = order === "sequential" && !!untrack(this._collapsedAccessor),
        collapsed = collapsedOverride ?? collapseTail;
      if (disabled) {
        // Held by an outer group. Propagate the hold (and whatever collapsed policy
        // the outer asked for) down the whole subtree. Inner order is ignored while
        // held; it resumes once the outer releases us.
        this._forEachOwnedSlot(slot => setSlotState(slot, this, true, collapsed));
      } else if (order === "natural") {
        // Each child reveals based on its own readiness. A nested controller slot
        // is released to run its own order locally — we bypass setSlotState for it
        // so the parent backpointer survives for upward readiness notifications.
        this._forEachOwnedSlot(slot => {
          if (isRevealController(slot)) {
            setSignal(slot._collapsed, false);
            setSignal(slot._disabled, false);
            slot.evaluate(false, false);
          } else {
            setSlotState(slot, this, !isSlotReady(slot), false);
          }
        });
      } else if (order === "together") {
        // Release when every direct slot is minimally ready (has something to show
        // under its own order). A fully-ready inner together is minimally ready;
        // sequential's first slot being ready is minimally ready; natural having any
        // ready child is minimally ready. This lets `together` guarantee a single
        // cohesive reveal without waiting for every grandchild.
        const minReady = this._forEachOwnedSlot(isSlotMinimallyReady);
        this._forEachOwnedSlot(slot => setSlotState(slot, this, !minReady, false));
      } else {
        let pendingSeen = false;
        this._forEachOwnedSlot(slot => {
          if (pendingSeen) return setSlotState(slot, this, true, collapseTail);
          if (isSlotReady(slot)) return setSlotState(slot, this, false, false);
          pendingSeen = true;
          // Frontier slot. For a leaf, holding `_disabled=true` is what keeps its
          // fallback visible. For a composite, we instead release it so it runs
          // its own order locally — its leaves will each show their own fallback
          // until their data lands. Outer still waits on full readiness before
          // advancing past this slot, and we bypass setSlotState so the parent
          // backpointer survives for upward readiness notifications.
          if (isRevealController(slot)) {
            setSignal(slot._collapsed, false);
            setSignal(slot._disabled, false);
            slot.evaluate(false, false);
          } else {
            setSlotState(slot, this, true, false);
          }
        });
      }
    } finally {
      this._ready = this.isReady();
      this._minimallyReady = this.isMinimallyReady();
      this._evaluating = false;
    }
    if (
      this._parentController &&
      (wasReady !== this._ready || wasMinReady !== this._minimallyReady)
    )
      this._parentController.evaluate();
  }
}

export class CollectionQueue extends Queue {
  _collectionType: number;
  _sources: Set<Computed<any>> = new Set();
  _tree?: BoundaryComputed<any>;
  _pending = true;
  _disabled: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _collapsed: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _revealController?: RevealController;
  _initialized: boolean = false;
  _onFn: (() => any) | undefined;
  _prevOn: any = ON_INIT;
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  run(type: number) {
    if (!type || (read(this._disabled) && (!_revealUsed || read(this._collapsed)))) return;
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

    if (this._collectionType & STATUS_PENDING && flags & STATUS_ERROR) {
      return super.notify(node, STATUS_ERROR, flags, error);
    }

    if (flags & this._collectionType) {
      this._pending = true;
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
      if (
        source._flags & REACTIVE_DISPOSED ||
        (!(source._statusFlags & this._collectionType) &&
          !(this._collectionType & STATUS_ERROR && source._statusFlags & STATUS_PENDING))
      )
        this._sources.delete(source);
    }
    if (!this._sources.size) {
      if (
        this._collectionType & STATUS_PENDING &&
        this._pending &&
        !this._initialized &&
        this._tree
      ) {
        this._pending = !!(this._tree._statusFlags & this._collectionType);
      } else {
        this._pending = false;
      }
      if (!this._pending) {
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
    if (_revealUsed) this._revealController?.evaluate();
  }
}

function createCollectionBoundary<T>(
  type: number,
  fn: () => any,
  fallback: (queue: CollectionQueue) => any,
  onFn?: () => any
) {
  if (__DEV__ && !getOwner()) {
    const message = "Boundaries created outside a reactive context will never be disposed.";
    emitDiagnostic({
      code: "NO_OWNER_BOUNDARY",
      kind: "lifecycle",
      severity: "warn",
      message,
      data: { boundaryType: type === STATUS_PENDING ? "loading" : "error" }
    });
    console.warn(message);
  }
  const owner = createOwner();
  if (_revealUsed) setContext(RevealControllerContext, null, owner);
  const queue = new CollectionQueue(type);
  if (onFn) queue._onFn = onFn;
  const tree = (queue._tree = createBoundChildren(owner, fn, queue, type) as BoundaryComputed<any>);
  // Prime source tracking so reveal registration sees pending sources.
  untrack(() => {
    let pending = false;
    try {
      read(tree);
    } catch (e) {
      if (e instanceof NotReadyError) pending = true;
      else throw e;
    }
    queue._pending =
      pending || !!(tree._statusFlags & type) || tree._error instanceof NotReadyError;
  });
  const controller =
    _revealUsed && type === STATUS_PENDING ? getContext(RevealControllerContext) : null;
  if (controller) {
    queue._revealController = controller;
    controller.register(queue);
    cleanup(() => controller.unregister(queue));
  }
  return accessor(
    computed(() => {
      if (!read(queue._disabled)) {
        const resolved = read(tree);
        if (!untrack(() => read(queue._disabled))) return ((queue._initialized = true), resolved);
      }
      if (_revealUsed && read(queue._collapsed)) return undefined;
      return fallback(queue);
    })
  );
}

/**
 * Lower-level primitive that backs the `<Loading>` flow control. Catches
 * pending async reads inside `fn` and renders `fallback` until they settle.
 *
 * App code should use `<Loading fallback={...}>` instead — reach for this only
 * when authoring custom boundary components.
 *
 * @param fn the tracked subtree
 * @param fallback the fallback shown while async reads in `fn` are unresolved
 * @param options `on` — accessor whose value scopes the boundary; when set,
 *   transitions caused by writes to other reactive sources are *not* caught
 */
export function createLoadingBoundary(
  fn: () => any,
  fallback: () => any,
  options?: { on?: () => any }
) {
  return createCollectionBoundary(STATUS_PENDING, fn, () => fallback(), options?.on);
}

/**
 * Lower-level primitive that backs the `<Errored>` flow control. Catches
 * thrown errors inside `fn` and invokes `fallback(error, reset)` instead.
 * `reset()` recomputes the failing sources so the boundary can attempt to
 * recover.
 *
 * App code should use `<Errored fallback={...}>` instead — reach for this only
 * when authoring custom boundary components.
 */
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

/**
 * Coordinate the reveal timing of sibling loading boundaries.
 *
 * Accepts reactive accessors:
 * - `order`: `"sequential"` (default) | `"together"` | `"natural"`.
 *   - `"sequential"` — classic frontier reveal: siblings reveal in registration order
 *     as each resolves; later siblings stay hidden until earlier ones complete.
 *   - `"together"` — every direct slot stays on its fallback until the whole group
 *     is "minimally ready" (each direct slot has produced its own first visible
 *     content under its own order), then the whole group releases at once.
 *   - `"natural"` — children reveal independently (as each resolves). At the top
 *     level this is a no-op compared to not using `createRevealOrder`; the mode
 *     exists for nesting, where the group registers as a single composite slot to
 *     any enclosing `createRevealOrder`.
 * - `collapsed`: only meaningful when `order === "sequential"`. When set, tail siblings
 *   past the frontier suppress their own fallback output. Ignored under `"together"`
 *   and `"natural"` — those orders have no frontier.
 *
 * Nested `createRevealOrder` groups compose: the inner controller registers as a
 * single slot in the outer controller and is held on its fallbacks until the outer
 * releases that slot. Once released, the inner controller runs its own order locally
 * over anything still pending. There is no opt-out from an outer hold.
 *
 * "Minimally ready" is what an order considers its first visible content:
 * - `sequential` — frontier-0 is minimally ready (leaf: on resolve; nested: via its
 *   own minimal signal).
 * - `together` — every direct slot is minimally ready.
 * - `natural` — any direct slot has visible content (leaves on resolve; nested
 *   composites when fully ready, since natural treats composites as atomic).
 */
export function createRevealOrder<T>(
  fn: () => T,
  options?: { order?: OrderAccessor; collapsed?: BoolAccessor }
): T {
  _revealUsed = true;
  const owner = createOwner();
  const parentController = getContext(RevealControllerContext);
  const order = options?.order || SEQUENTIAL_ACCESSOR,
    collapsed = options?.collapsed || FALSE_ACCESSOR;
  const controller = new RevealController(order, collapsed);
  setContext(RevealControllerContext, controller, owner);
  return runWithOwner(owner, () => {
    const value = fn();
    computed(() => {
      order();
      collapsed();
      controller.evaluate();
    });
    if (parentController) {
      controller._parentController = parentController;
      parentController.register(controller);
      cleanup(() => parentController.unregister(controller));
    }
    return value;
  });
}

/**
 * Resolves a children value to its renderable form: unwraps zero-arg functions
 * (accessors), recursively flattens arrays, and optionally skips
 * non-rendering values (`null`, `undefined`, `true`, `false`, `""`).
 *
 * Used internally by flow components and by the renderer to walk a children
 * tree. App code rarely needs this directly — see `children()` in `solid-js`
 * for the user-facing helper that memoizes the result.
 *
 * @param children value or array of values to flatten
 * @param options
 *   - `skipNonRendered` — drop values that won't render
 *   - `doNotUnwrap` — leave function children as-is (caller will resolve)
 */
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
