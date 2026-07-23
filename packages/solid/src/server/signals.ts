// Mock @solidjs/signals for server-side rendering
// Re-exports infrastructure from the real package, reimplements reactive primitives as pull-based.

import { $REFRESH } from "@solidjs/signals";
export { $REFRESH };

// === Re-exports from @solidjs/signals (infrastructure — no reactive scheduling) ===
//
// Owner runtime (`createOwner`, `runWithOwner`, `getOwner`, `isDisposed`,
// `onCleanup`, `getNextChildId`, `createContext`, `setContext`, `getContext`,
// `createRoot`) is implemented locally below. The upstream owner carries
// scheduler / heap / zombie / dev-mode metadata that SSR doesn't need — the
// lean SSR owner is a forward-only linked list with cleanup hooks and an id.
//
// Errors and pure-utility surface stays imported from upstream.

export {
  NotReadyError,
  NoOwnerError,
  ContextNotFoundError,
  isEqual,
  isWrappable,
  SUPPORTS_PROXY,
  enableExternalSource,
  enforceLoadingBoundary
} from "@solidjs/signals";

export { flatten } from "@solidjs/signals";
export { snapshot, omit, storePath, $PROXY, $TRACK } from "@solidjs/signals";

// === Type re-exports ===

import type { Accessor as SignalAccessor, Refreshable } from "@solidjs/signals";

export type SourceAccessor<T> = Refreshable<SignalAccessor<T>>;

export type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectBundle,
  EffectOptions,
  ExternalSource,
  ExternalSourceConfig,
  ExternalSourceFactory,
  MemoOptions,
  NoInfer,
  SignalOptions,
  Setter,
  Signal,
  Owner,
  Refreshable,
  Maybe,
  Store,
  StoreSetter,
  StoreNode,
  NotWrappable,
  SolidStore,
  Merge,
  Omit,
  Context,
  ContextRecord,
  IQueue,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial,
  Part,
  PathSetter
} from "@solidjs/signals";

// === Local imports ===

import {
  $PROXY,
  isWrappable,
  merge as signalMerge,
  NotReadyError,
  NoOwnerError,
  ContextNotFoundError
} from "@solidjs/signals";

import type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectBundle,
  EffectOptions,
  MemoOptions,
  SignalOptions,
  Setter,
  Signal,
  Merge,
  Owner,
  Store,
  StoreSetter,
  Context
} from "@solidjs/signals";

import { sharedConfig, NoHydrateContext } from "./shared.js";

// === Lean SSR Owner Runtime ===
//
// SSR is single-pass and pull-based: there is no scheduler, no heap, no
// zombie/check graph, no observer link list. We replace the upstream owner
// runtime with a minimal forward-only linked list that supports just what
// SSR needs:
//
//   * id allocation (for hydration plumbing) + transparent ancestor walk
//   * onCleanup hooks (used by boundary retry in `createErrorBoundary`)
//   * context lookup via lazily-cloned record (matches upstream semantics)
//   * runWithOwner / getOwner / isDisposed / createRoot
//
// Compared to the upstream `Owner` shape (~14 fields), `SSROwner` carries 9
// — no `_queue`, `_pendingDisposal`, `_pendingFirstChild`, `_prevSibling`,
// `_config`, `_snapshotScope`, `_flags`. Smaller object → less per-render
// allocation and faster GC.

type Disposable = () => void;

interface SSROwner {
  id?: string;
  _transparent: boolean;
  _disposal: Disposable | Disposable[] | null;
  _parent: SSROwner | null;
  _context: Record<symbol | string, unknown>;
  _childCount: number;
  _firstChild: SSROwner | null;
  _nextSibling: SSROwner | null;
  _disposed: boolean;
}

const defaultSSRContext: Record<symbol | string, unknown> = {};

let currentOwner: SSROwner | null = null;

// SSR owner pool. SSR disposes the entire owner tree at end-of-render via
// `createRoot`'s dispose hook, so we can reclaim every owner back into a
// freelist for the next render. Pooling moves steady-state owner allocation
// from O(owners-per-render) down to ~0 for repeat renders of the same shape.
//
// Capped to bound memory; oversize bursts (e.g. one-shot 100k row render)
// just re-allocate beyond the cap.
const OWNER_POOL_MAX = 4096;
const ownerPool: SSROwner[] = [];

function formatChildId(prefix: string, id: number): string {
  const num = id.toString(36);
  const len = num.length - 1;
  return prefix + (len ? String.fromCharCode(64 + len) : "") + num;
}

function nextChildIdFor(owner: SSROwner, consume: boolean): string {
  let counter = owner;
  while (counter._transparent && counter._parent) counter = counter._parent;
  if (counter.id != null) {
    return formatChildId(counter.id, consume ? counter._childCount++ : counter._childCount);
  }
  throw new Error("Cannot get child id from owner without an id");
}

function consumeClientComputedSlot(owner: SSROwner | null): void {
  if (owner?.id != null) nextChildIdFor(owner, true);
}

export function getNextChildId(owner: Owner): string {
  return nextChildIdFor(owner as unknown as SSROwner, true);
}

export function peekNextChildId(owner: Owner): string {
  return nextChildIdFor(owner as unknown as SSROwner, false);
}

export function createOwner(options?: { id?: string; transparent?: boolean }): Owner {
  const parent = currentOwner;
  const transparent = options?.transparent ?? false;
  const id =
    options?.id ??
    (transparent ? parent?.id : parent?.id != null ? nextChildIdFor(parent, true) : undefined);
  const ctx = parent?._context ?? defaultSSRContext;
  let owner: SSROwner;
  if (ownerPool.length) {
    // Reuse a recycled owner. Reset all fields so the hidden class stays
    // monomorphic and we don't carry stale references. (Allocation is the
    // hot path — re-initializing 9 slots is much cheaper than `new`.)
    owner = ownerPool.pop()!;
    owner.id = id;
    owner._transparent = transparent;
    owner._disposal = null;
    owner._parent = parent;
    owner._context = ctx;
    owner._childCount = 0;
    owner._firstChild = null;
    owner._nextSibling = null;
    owner._disposed = false;
  } else {
    owner = {
      id,
      _transparent: transparent,
      _disposal: null,
      _parent: parent,
      _context: ctx,
      _childCount: 0,
      _firstChild: null,
      _nextSibling: null,
      _disposed: false
    };
  }
  if (parent) {
    // Forward-only linked list. We push at head; iteration during disposal
    // walks `_firstChild` -> `_nextSibling`. SSR doesn't depend on sibling
    // order — only the bag of children, which is fully covered.
    const lastChild = parent._firstChild;
    if (lastChild) owner._nextSibling = lastChild;
    parent._firstChild = owner;
  }
  return owner as unknown as Owner;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner as unknown as SSROwner | null;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

export function getOwner(): Owner | null {
  return currentOwner as unknown as Owner | null;
}

export function isDisposed(owner: Owner): boolean {
  return (owner as unknown as SSROwner)._disposed;
}

export function onCleanup(fn: Disposable): Disposable {
  const o = currentOwner;
  if (!o) return fn;
  if (!o._disposal) o._disposal = fn;
  else if (Array.isArray(o._disposal)) o._disposal.push(fn);
  else o._disposal = [o._disposal, fn];
  return fn;
}

export function createContext<T>(defaultValue?: T, description?: string): Context<T> {
  return { id: Symbol(description), defaultValue };
}

export function getContext<T>(
  context: Context<T>,
  owner: Owner | null = currentOwner as unknown as Owner | null
): T {
  if (!owner) throw new NoOwnerError();
  const map = (owner as unknown as SSROwner)._context;
  const stored = map[context.id];
  const value = stored !== undefined ? (stored as T) : context.defaultValue;
  if (value === undefined) throw new ContextNotFoundError();
  return value as T;
}

export function setContext<T>(
  context: Context<T>,
  value?: T,
  owner: Owner | null = currentOwner as unknown as Owner | null
): void {
  if (!owner) throw new NoOwnerError();
  const o = owner as unknown as SSROwner;
  // Clone (matches upstream): without this, a child's setContext would leak
  // back into the parent's _context map.
  o._context = {
    ...o._context,
    [context.id]: value === undefined ? context.defaultValue : value
  };
}

// Detach a disposed owner from its parent's child chain before pooling.
// Without this, the parent still points at the pooled node, and once the
// pool recycles it into a *different* tree, disposing the old parent walks
// into the new tree and tears down live owners (#2863).
function unlinkOwner(node: SSROwner): void {
  const parent = node._parent;
  if (!parent) return;
  if (parent._firstChild === node) parent._firstChild = node._nextSibling;
  else {
    let sibling = parent._firstChild;
    while (sibling && sibling._nextSibling !== node) sibling = sibling._nextSibling;
    if (sibling) sibling._nextSibling = node._nextSibling;
  }
  node._parent = null;
  node._nextSibling = null;
}

/**
 * Tears down `owner` (optionally) and all of its descendants. Walks the
 * forward-only `_firstChild` -> `_nextSibling` chain, recursively disposing
 * each child with `self=true`, then runs the owner's own `_disposal` queue
 * and resets `_firstChild` / `_childCount`.
 *
 * `self=false` keeps `owner` itself alive (its `_disposed` flag stays clear,
 * future `runWithOwner(owner, ...)` keeps working) but tears down its
 * subtree. This is what `createErrorBoundary` and `createLoadingBoundary`
 * use on retry — wipe the children, keep the boundary owner around for the
 * re-run.
 *
 * @internal
 */
export function disposeOwner(owner: Owner, self: boolean = true): void {
  const node = owner as unknown as SSROwner;
  if (node._disposed) return;
  // Leaf fast path: no children, no cleanup. Most For/Repeat row owners
  // hit this — `<li>` row bodies don't onCleanup and don't spawn nested
  // owners. Skips the recursion stack frame and the work-detection branches.
  if (!node._firstChild && !node._disposal) {
    if (self) {
      node._disposed = true;
      unlinkOwner(node);
      if (ownerPool.length < OWNER_POOL_MAX) {
        node.id = undefined;
        ownerPool.push(node);
      }
    } else {
      // Id slots can be consumed without creating child owners
      // (createUniqueId, ssrScope reservations, client-computed slots), so a
      // retry reset (`self=false`) must still rewind the counter — otherwise
      // every boundary discovery pass drifts the ids of the eventual
      // successful run past the client's (#2900).
      node._childCount = 0;
    }
    return;
  }
  if (self) node._disposed = true;
  let child = node._firstChild;
  while (child) {
    const next = child._nextSibling;
    disposeOwner(child as unknown as Owner, true);
    child = next;
  }
  node._firstChild = null;
  node._childCount = 0;
  const d = node._disposal;
  if (d) {
    if (Array.isArray(d)) {
      for (let i = 0, len = d.length; i < len; i++) d[i]();
    } else {
      d();
    }
    node._disposal = null;
  }
  if (self) unlinkOwner(node);
  // Recycle the disposed owner. Skip the root case (`self=false`) and the
  // already-pooled case so we don't double-add. The next `createOwner` will
  // overwrite all fields, so we only need to drop heavy references here.
  if (self && ownerPool.length < OWNER_POOL_MAX) {
    node.id = undefined;
    ownerPool.push(node);
  }
}

/**
 * Client parity for async retries (#2900): on the client every recompute
 * disposes the owner's children and resets `_childCount`, so child hydration
 * ids are stable across reruns. Call before re-running a compute under the
 * same owner. Runs the owner's own `_disposal` too — the failed run's
 * onCleanups must fire like any recompute's — which is why the retrying
 * primitives register their lifecycle cleanup (`comp.disposed`) on the
 * creation context rather than on `owner`: a retry must not cancel itself.
 *
 * @internal
 */
export function resetOwnerForRerun(owner: Owner): void {
  const node = owner as unknown as SSROwner;
  if (node._firstChild || node._disposal) disposeOwner(owner, false);
  node._childCount = 0;
}

export function createRoot<T>(
  init: ((dispose: () => void) => T) | (() => T),
  options?: { id?: string; transparent?: boolean }
): T {
  const owner = createOwner(options);
  return runWithOwner(owner, () => init(() => disposeOwner(owner)));
}

/**
 * Id scope for a dynamic child hole ("hole owner"). One id slot is reserved
 * from the enclosing owner at registration time — in source order — so
 * sibling ids can't shift when the hole's evaluation is deferred by async
 * and retried later. Every evaluation attempt runs with the reserved id and
 * a zeroed child counter, making retries deterministic. Mirrors the client,
 * where the outer insert effect for the same hole is non-transparent (its
 * own id scope).
 *
 * Emitted by the ssr generate as `_$scope(...)` around deferred child holes
 * that can allocate hydration ids. Hot per-row path (one per qualifying
 * hole), so no owner object is allocated — like mapArray's row-owner
 * elision, the scope is virtual: the parent owner's `id`/`_childCount` are
 * swapped around the evaluation. Content created during the evaluation
 * attaches to the parent owner, which matches the pre-scope disposal
 * semantics (boundary retries dispose it via the boundary owner).
 */
export function ssrScope<T>(fn: () => T): () => unknown {
  const parent = currentOwner;
  // No id plumbing to protect (non-hydrating SSR / owner-less evaluation).
  if (!parent || parent.id == null) return fn;
  const scopeId = nextChildIdFor(parent, true);
  return () => {
    const prevId = parent.id;
    const prevCount = parent._childCount;
    parent.id = scopeId;
    parent._childCount = 0;
    try {
      let v: unknown = fn();
      // Unwrap accessor chains in-scope: reading a memo / component thunk can
      // create owners and allocate ids, which must land under the hole scope
      // just like the client's inner unwrapping effect (transparent, so it
      // shares the outer insert effect's scope).
      while (typeof v === "function") v = (v as () => unknown)();
      return v;
    } finally {
      parent.id = prevId;
      parent._childCount = prevCount;
    }
  };
}

// === Observer tracking (for async memo) ===

interface ServerComputation<T = any> {
  owner: Owner;
  value: T;
  compute: ComputeFunction<any, T>;
  error: unknown;
  // Error presence is a flag, not a truthiness test on `error` — a rejection
  // with a falsy value (undefined, null, "", 0, false) is still a rejection
  // and must throw on read like any other (#2857).
  errored: boolean;
  computed: boolean;
  disposed: boolean;
}

type SsrSourceMode = "server" | "hybrid" | "client";
type ServerSsrOptions = { deferStream?: boolean; ssrSource?: SsrSourceMode };
type ServerClientMemoOptions<T> = Omit<MemoOptions<T>, "ssrSource"> & { ssrSource: "client" };
type ServerMemoOptions<T> = Omit<MemoOptions<T>, "ssrSource"> & { ssrSource?: "server" | "hybrid" };
type ServerClientSignalOptions<T> = Omit<SignalOptions<T>, "ssrSource"> & { ssrSource: "client" };
type ServerSignalOptions<T> = Omit<SignalOptions<T>, "ssrSource"> & {
  ssrSource?: "server" | "hybrid";
};

let Observer: ServerComputation | null = null;

function runWithObserver<T>(comp: ServerComputation, fn: () => T): T {
  const prev = Observer;
  Observer = comp;
  try {
    return fn();
  } finally {
    Observer = prev;
  }
}

export function getObserver() {
  return Observer;
}

type DeferredPromise<T> = {
  promise: Promise<T> & { s?: 1 | 2; v?: any };
  resolve: (value: T) => void;
  reject: (error: any) => void;
};

function createDeferredPromise<T>(): DeferredPromise<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: any) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  }) as DeferredPromise<T>["promise"];

  return {
    promise,
    resolve(value: T) {
      if (settled) return;
      settled = true;
      promise.s = 1;
      promise.v = value;
      resolvePromise(value);
    },
    reject(error: any) {
      if (settled) return;
      settled = true;
      promise.s = 2;
      promise.v = error;
      rejectPromise(error);
    }
  };
}

// Object-thenable detection (Promises/A+ shape) — mirrors the client async
// runtime (`isThenable` in @solidjs/signals core/async.ts). Custom thenables,
// cache wrappers, and cross-realm promises must take the async path like
// native Promises (#2858).
function isThenable<T>(value: any): value is PromiseLike<T> {
  return value != null && typeof value === "object" && typeof value.then === "function";
}

function subscribePendingRetry(error: any, retry: () => void): boolean {
  if (!(error instanceof NotReadyError)) return false;
  (error as any).source?.then(
    () => retry(),
    () => retry()
  );
  return true;
}

function settleServerAsync<T, U>(
  initial: T | PromiseLike<T>,
  rerun: () => T | PromiseLike<T>,
  deferred: DeferredPromise<U>,
  onSuccess: (value: T) => U,
  onError: (error: any) => void,
  isDisposed: () => boolean
) {
  let first = true;

  const attempt = () => {
    if (isDisposed()) return;

    let current: T | PromiseLike<T>;
    try {
      current = first ? initial : rerun();
      first = false;
    } catch (error) {
      if (subscribePendingRetry(error, attempt)) return;
      onError(error);
      deferred.reject(error);
      return;
    }

    Promise.resolve(current).then(
      value => {
        if (isDisposed()) return;
        deferred.resolve(onSuccess(value));
      },
      error => {
        if (isDisposed()) return;
        if (subscribePendingRetry(error, attempt)) return;
        onError(error);
        deferred.reject(error);
      }
    );
  };

  attempt();
}

// === Reactive Primitives (pull-based) ===

export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options: ServerClientSignalOptions<T>
): Signal<T | undefined>;
export function createSignal<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerSignalOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ComputeFunction<any, any>,
  second?: SignalOptions<any>
): Signal<T | undefined> {
  if (typeof first === "function") {
    const opts =
      second?.deferStream || second?.ssrSource
        ? { deferStream: second?.deferStream, ssrSource: second?.ssrSource }
        : undefined;
    const memo = createMemo<T>((prev?: T) => (first as (prev?: T) => T)(prev), opts as any);
    return [memo, (() => undefined) as Setter<T | undefined>];
  }
  // Plain value form — no ID allocation (IDs are only for owners/computations)
  return [
    () => first as T,
    v => {
      return ((first as any) = typeof v === "function" ? (v as (prev: T) => T)(first as T) : v);
    }
  ] as Signal<T | undefined>;
}

export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options: ServerClientMemoOptions<T>
): SourceAccessor<T | undefined>;
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerMemoOptions<T>
): SourceAccessor<T>;
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerClientMemoOptions<T> | ServerMemoOptions<T>
): SourceAccessor<T | undefined> {
  // Sync fast path — set by the compiler-emitted `_$memo()` / `_$effect()`
  // wrappers (see `solid-web/src/core.ts`) and by internal control-flow
  // primitives (mapArray, repeat, Show, Switch, children, lazy). These
  // computes are statically guaranteed never to return a Promise /
  // AsyncIterable, so we skip the full async-aware ServerComputation /
  // processResult / $REFRESH / runWithObserver / onCleanup scaffolding.
  // They CAN still throw `NotReadyError`; that propagates to the nearest
  // boundary on read, which is exactly the same behaviour the boundary
  // already drives via re-discovery — no per-memo retry subscription needed.
  if (options?.sync) {
    return createSyncMemo(compute, options);
  }
  // Capture SSR context at creation time — async re-computations (via .then callbacks)
  // may run after a concurrent request has overwritten sharedConfig.context.
  const ctx = sharedConfig.context;
  const owner = createOwner();
  const comp: ServerComputation<T> = {
    owner,
    value: undefined as any,
    compute: compute as ComputeFunction<any, T>,
    error: undefined,
    errored: false,
    computed: false,
    disposed: false
  };
  // When the surrounding scope is disposed (e.g., Loading boundary retries),
  // mark the computation so in-flight Promise chains don't produce stale
  // serialization. Registered on the creation context, NOT on `owner`:
  // async-retry reruns reset `owner` via resetOwnerForRerun (which runs its
  // `_disposal`), and a self-registered flag would cancel the retry (#2900).
  onCleanup(() => {
    comp.disposed = true;
  });

  function update() {
    if (comp.disposed) return;
    const run = () => {
      resetOwnerForRerun(owner);
      return runWithOwner(owner, () => runWithObserver(comp, () => comp.compute(comp.value)));
    };
    try {
      comp.error = undefined;
      comp.errored = false;
      const result = run();
      comp.computed = true;
      processResult(comp, result, owner, ctx, options?.deferStream, options?.ssrSource, run);
    } catch (err) {
      if (err instanceof NotReadyError) {
        subscribePendingRetry(err, update);
      }
      comp.error = err;
      comp.errored = true;
      comp.computed = true;
    }
  }

  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    // Skip computation and keep the value uninitialized. Owner created for ID parity.
    comp.computed = true;
  } else if (!options?.lazy) {
    update();
  }

  const read = (() => {
    // Lazy: compute on first read
    if (!comp.computed) {
      update();
    }
    if (comp.errored) {
      throw comp.error;
    }
    return comp.value;
  }) as SourceAccessor<T | undefined>;
  (read as any)[$REFRESH] = comp;
  return read;
}

/**
 * Lean SSR memo for computes statically guaranteed to return synchronously
 * (no Promise / AsyncIterable result).
 *
 * Used by:
 *   - the compiler-emitted `_$memo()` / `_$effect()` wrappers
 *     (`solid-web/src/core.ts`)
 *   - internal control-flow primitives (mapArray, repeat, Show, Switch,
 *     children flatten, lazy outer)
 *
 * Architecture note: SSR retry is owned by the streaming engine, not the
 * memo. When a hole pulls and the body throws `NotReadyError`, the engine
 * pushes the hole back into `result.h`/`result.p` and re-pulls when the
 * source promise resolves (see `resolveSSRNode` in dom-expressions). So
 * we just don't latch a pending result — the next pull recomputes.
 *
 * Caches:
 *   - successful values (deduplicates re-reads inside one render walk)
 *   - real errors (engine surfaces these via `ssrHandleError`)
 *
 * Does NOT support (by design — sync memos don't sit on these surfaces):
 *   - `ssrSource` / hybrid client-server hints (those imply async data)
 *   - `equals` / observation (no subscriber graph on the server)
 *   - `$REFRESH` / async refresh subscriber path
 *
 * Honored options: `lazy` (defer compute until first read).
 */
function createSyncMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerMemoOptions<T> | ServerClientMemoOptions<T>
): SourceAccessor<T | undefined> {
  const owner = createOwner();
  let value: T | undefined;
  let error: unknown;
  // Presence flag for `error` — a falsy thrown value is still an error (#2857).
  let errored = false;
  // True iff the next read should return cached state (success or real error).
  // Stays false while `value` reflects a previous successful run AND a later
  // pull is needed (initial: never run; after `NotReadyError`: needs retry).
  let cached = false;

  function pull(): T | undefined {
    // Inlined `runWithOwner` — avoids the per-pull `() => compute(value)`
    // closure alloc that `runWithOwner(owner, fn)` would force. Hot for the
    // compiler-emitted `_$memo()` ternary wrap on conditional JSX, where one
    // memo + one pull is paid per row.
    const prev = currentOwner;
    currentOwner = owner as unknown as SSROwner;
    // A pull after `NotReadyError` re-runs the compute under the same owner.
    // Mirror the client's per-recompute child reset — otherwise every failed
    // pull leaks the child-id slots it consumed (e.g. the compiler-emitted
    // inner memo of `{cond && <jsx>}`) and the hydration keys of everything
    // created by the eventual successful pull drift ahead of the client's
    // (#2801, generalized to all retry paths in #2900).
    resetOwnerForRerun(owner);
    try {
      value = compute(value) as T;
      error = undefined;
      errored = false;
      cached = true;
      return value;
    } catch (err) {
      if (err instanceof NotReadyError) throw err; // don't latch — engine re-pulls
      error = err;
      errored = true;
      cached = true;
      throw err;
    } finally {
      currentOwner = prev;
    }
  }

  if (!options?.lazy) {
    try {
      pull();
    } catch {
      /* error/pending already recorded on `cached`/`error`; surface on read */
    }
  }

  return (() => {
    if (cached) {
      if (errored) throw error;
      return value;
    }
    return pull();
  }) as SourceAccessor<T | undefined>;
}

// === Deep Proxy for Patch Tracking (projections with async iterables) ===

export type PatchOp =
  | [path: PropertyKey[]]
  | [path: PropertyKey[], value: any]
  | [path: PropertyKey[], value: any, insert: 1];

export function createDeepProxy<T extends object>(
  target: T,
  patches: PatchOp[],
  basePath: PropertyKey[] = []
): T {
  const childProxies = new Map<PropertyKey, any>();

  const handler: ProxyHandler<any> = {
    get(obj, key, receiver) {
      if (Array.isArray(obj)) {
        if (key === "shift") {
          return function () {
            if (obj.length === 0) return undefined;
            const removed = obj[0];
            Array.prototype.shift.call(obj);
            childProxies.clear();
            patches.push([[...basePath, 0]]);
            return removed;
          };
        }
        if (key === "unshift") {
          return function (...items: any[]) {
            const result = Array.prototype.unshift.apply(obj, items);
            childProxies.clear();
            for (let i = 0; i < items.length; i++) {
              patches.push([[...basePath, i], items[i], 1]);
            }
            return result;
          };
        }
        if (key === "splice") {
          return function (start: number, deleteCount?: number, ...items: any[]) {
            const len = obj.length;
            const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
            const d =
              deleteCount === undefined ? len - s : Math.min(Math.max(deleteCount, 0), len - s);
            const removed = Array.prototype.splice.apply(obj, [s, d, ...items]);
            childProxies.clear();
            for (let i = 0; i < d; i++) patches.push([[...basePath, s]]);
            for (let i = 0; i < items.length; i++)
              patches.push([[...basePath, s + i], items[i], 1]);
            return removed;
          };
        }
      }

      const value = Reflect.get(obj, key, receiver);
      if (value !== null && typeof value === "object" && typeof key !== "symbol") {
        if (!childProxies.has(key)) {
          childProxies.set(key, createDeepProxy(value, patches, [...basePath, key]));
        }
        return childProxies.get(key);
      }
      return value;
    },

    set(obj, key, value) {
      childProxies.delete(key);
      patches.push([[...basePath, key], value]);
      return Reflect.set(obj, key, value);
    },

    deleteProperty(obj, key) {
      childProxies.delete(key);
      patches.push([[...basePath, key]]);
      return Reflect.deleteProperty(obj, key);
    }
  };

  return new Proxy(target, handler);
}

/** Process async results from a computation (Promise / AsyncIterable) */
function processResult<T>(
  comp: ServerComputation<T>,
  result: any,
  owner: Owner,
  ctx: any,
  deferStream?: boolean,
  ssrSource?: SsrSourceMode,
  rerun?: () => any
) {
  if (comp.disposed) return;
  const id = owner.id;
  const noHydrate = getContext(NoHydrateContext, owner);

  // Async-iterable takes precedence over thenable, mirroring the client
  // runtime's detection order (`handleAsync` in @solidjs/signals core/async.ts).
  if (typeof (result as any)?.[Symbol.asyncIterator] !== "function" && isThenable<T>(result)) {
    if ((result as any).s === 1) {
      comp.value = (result as any).v;
      comp.error = undefined;
      comp.errored = false;
      return;
    }
    if ((result as any).s === 2) {
      comp.error = (result as any).v;
      comp.errored = true;
      return;
    }
    const deferred = createDeferredPromise<T>();
    if (ctx?.async && ctx.serialize && id && !noHydrate)
      ctx.serialize(id, deferred.promise, deferStream);
    settleServerAsync(
      result,
      () => (rerun ? rerun() : result),
      deferred,
      (value: T) => {
        (result as any).s = 1;
        (result as any).v = value;
        comp.value = value;
        comp.error = undefined;
        comp.errored = false;
        return value;
      },
      (error: any) => {
        (result as any).s = 2;
        (result as any).v = error;
        comp.error = error;
        comp.errored = true;
      },
      () => comp.disposed
    );
    comp.error = new NotReadyError(deferred.promise);
    comp.errored = true;
    return;
  }

  const iterator = result?.[Symbol.asyncIterator];
  if (typeof iterator === "function") {
    if (ssrSource === "hybrid") {
      let currentResult = result;
      let iter: AsyncIterator<T>;
      const deferred = createDeferredPromise<T>();
      const runFirst = () => {
        const source = currentResult ?? (rerun ? rerun() : result);
        currentResult = undefined;
        const nextIterator = source?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createMemo");
        }
        iter = nextIterator.call(source);
        return iter.next().then((value: IteratorResult<T>) => {
          if (!value.done) closeAsyncIterator(iter);
          return value.value;
        });
      };
      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        (value: T) => {
          comp.value = value;
          comp.error = undefined;
          comp.errored = false;
          return value;
        },
        (error: any) => {
          comp.error = error;
          comp.errored = true;
        },
        () => comp.disposed
      );
      if (ctx?.async && ctx.serialize && id && !noHydrate)
        ctx.serialize(id, deferred.promise, deferStream);
      comp.error = new NotReadyError(deferred.promise);
      comp.errored = true;
    } else {
      // Full streaming ("server" or default): eagerly start the first iteration.
      // Tapped wrapper replays first value, then delegates to iter for the rest.
      let currentResult = result;
      let iter: AsyncIterator<T>;
      let firstResult: IteratorResult<T> | undefined;
      const deferred = createDeferredPromise<void>();
      const runFirst = () => {
        const source = currentResult ?? (rerun ? rerun() : result);
        currentResult = undefined;
        const nextIterator = source?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createMemo");
        }
        iter = nextIterator.call(source);
        return iter.next().then((value: IteratorResult<T>) => {
          firstResult = value;
          // Resolve nesting: delays outer promise settlement by 1 microtask,
          // giving seroval's push() time to call stream.next() before Loading completes.
          return Promise.resolve();
        });
      };

      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        () => {
          const resolved = firstResult;
          if (resolved && !resolved.done) {
            comp.value = resolved.value;
          }
          comp.error = undefined;
          comp.errored = false;
          return undefined;
        },
        (error: any) => {
          comp.error = error;
          comp.errored = true;
        },
        () => comp.disposed
      );

      if (ctx?.async && ctx.serialize && id && !noHydrate) {
        let tappedFirst = true;
        const tapped = {
          [Symbol.asyncIterator]: () => ({
            next() {
              if (tappedFirst) {
                tappedFirst = false;
                return deferred.promise.then(() =>
                  firstResult?.done
                    ? ({ done: true as const, value: undefined } as IteratorResult<T>)
                    : (firstResult as IteratorResult<T>)
                );
              }
              return iter.next().then((r: IteratorResult<T>) => r);
            },
            return(value?: any) {
              return iter.return?.(value);
            }
          })
        };
        ctx.serialize(id, tapped, deferStream);
      }
      comp.error = new NotReadyError(deferred.promise);
      comp.errored = true;
    }
    return;
  }

  // Synchronous value
  comp.value = result;
}

function closeAsyncIterator(iter: any, value?: any) {
  const returned = iter.return?.(value);
  if (returned && typeof returned.then === "function") {
    returned.then(undefined, () => {});
  }
}

// === Effects ===

function serverEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<T, T> | undefined,
  options: EffectOptions | undefined
): void {
  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    createOwner();
    return;
  }
  const ctx = sharedConfig.context;
  const owner = createOwner();
  const comp: ServerComputation<T> = {
    owner,
    value: undefined as any,
    compute: compute as ComputeFunction<any, T>,
    error: undefined,
    errored: false,
    computed: true,
    disposed: false
  };
  if (ssrSource || effectFn) {
    // On the creation context, not `owner` — retry resets `owner` (#2900).
    onCleanup(() => {
      comp.disposed = true;
    });
  }
  try {
    const result = runWithOwner(owner, () =>
      runWithObserver(comp, () => (compute as ComputeFunction<any, T>)(undefined))
    );
    if (ssrSource) {
      processResult(comp, result, owner, ctx, options?.deferStream, ssrSource);
    }
    // `defer: true` skips the initial side-effect run (client parity — the
    // compute still runs for tracking); on the server a "next change" never
    // comes, so the effect function simply never fires (#2811).
    if (!options?.defer)
      effectFn?.((ssrSource ? (comp.value ?? result) : result) as any, undefined);
  } catch (err) {
    if (err instanceof NotReadyError) {
      // A pending read must never throw through the middle of the render —
      // that forces the surrounding Loading boundary to rebuild its whole
      // subtree on every settle, re-creating the async work each time in an
      // infinite discovery loop (#2801). Render effects impact boundaries
      // (they're the client's async notification path), so register the
      // pending source with the stream — holding flush like top-level JSX
      // async — and retry once it settles so the effect function runs with
      // the resolved value. Plain createEffect never impacts boundaries even
      // on the client (it runs the reactivity but doesn't register as an
      // async blocker), so it's swallowed outright.
      if (effectFn && ctx?.async) {
        const source = (err as NotReadyError).source as Promise<any>;
        const retry = () => {
          if (comp.disposed) return;
          try {
            resetOwnerForRerun(owner);
            const result = runWithOwner(owner, () =>
              runWithObserver(comp, () => (compute as ComputeFunction<any, T>)(undefined))
            );
            if (!options?.defer) effectFn(result as any, undefined);
          } catch (retryErr) {
            if (retryErr instanceof NotReadyError) {
              const next = (retryErr as NotReadyError).source as Promise<any>;
              ctx.block(next.then(retry, () => {}));
              return;
            }
            // Out-of-band by now — route to the boundary's error handler.
            const handler = getContext(ErrorContext, owner);
            if (handler) handler(retryErr);
            else throw retryErr;
          }
        };
        ctx.block(source.then(retry, () => {}));
      }
      return;
    }
    // For real errors, record on the computation and re-throw so a wrapping
    // `createErrorBoundary` / `<Errored>` can catch instead of the error
    // vanishing into the void (#2777).
    comp.error = err;
    comp.errored = true;
    throw err;
  }
}

export function createEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effect: EffectFunction<NoInfer<T>, T> | EffectBundle<NoInfer<T>, T>,
  options?: EffectOptions
): void {
  serverEffect(compute, undefined, options);
}

export function createRenderEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<NoInfer<T>, T>,
  options?: EffectOptions
): void {
  serverEffect(compute, effectFn, options);
}

export function createTrackedEffect(
  compute: () => void | (() => void),
  options?: { name?: string }
): void {
  // No-op on server, but allocate computation ID
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
}

export function createReaction(
  effectFn: EffectFunction<undefined> | EffectBundle<undefined>,
  options?: EffectOptions
) {
  return (tracking: () => void) => {
    tracking();
  };
}

// === Optimistic ===

export function createOptimistic<T>(): Signal<T | undefined>;
export function createOptimistic<T>(
  value: Exclude<T, Function>,
  options?: SignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options: ServerClientSignalOptions<T>
): Signal<T | undefined>;
export function createOptimistic<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerSignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  first?: T | ComputeFunction<any, any>,
  second?: SignalOptions<any>
): Signal<T | undefined> {
  // On server, optimistic is the same as regular signal
  return (createSignal as Function)(first, second);
}

// === Store (plain objects, no proxy) ===

function setProperty(state: any, property: PropertyKey, value: any) {
  if (state[property] === value) return;
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
}

export function createStore<T extends object>(
  store: T | Store<T>,
  options?: { name?: string; shallow?: boolean }
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object>(
  fn: (store: T) => void | T | Promise<void | T>,
  store: Partial<T> | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object>(
  first: T | Store<T> | ((store: T) => void | T | Promise<void | T>),
  second?: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>] {
  if (typeof first === "function") {
    const store = createProjection(first as any, second as T);
    return [store as Store<T>, ((fn: (state: T) => void) => fn(store as T)) as StoreSetter<T>];
  }
  const state = first as T;
  return [state as Store<T>, ((fn: (state: T) => void) => fn(state as T)) as StoreSetter<T>];
}

export const createOptimisticStore = createStore;

/**
 * Wraps a store in a Proxy that throws NotReadyError on property reads
 * while the async data is pending. Once markReady() is called, reads
 * pass through to the underlying state.
 */
function createPendingProxy<T extends object>(
  state: T,
  source: Promise<any>
): [proxy: Store<T>, markReady: (frozenState?: T) => void] {
  let pending = true;
  let readTarget: T = state;
  const proxy = new Proxy(state, {
    get(obj, key, receiver) {
      if (pending && typeof key !== "symbol") {
        throw new NotReadyError(source);
      }
      return Reflect.get(readTarget, key);
    }
  });
  return [
    proxy as Store<T>,
    (frozen?: T) => {
      if (frozen) readTarget = frozen;
      pending = false;
    }
  ];
}

export function createProjection<T extends object>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: Partial<T> | Store<T>,
  options?: ServerSsrOptions
): Store<T> {
  const ctx = sharedConfig.context;
  const owner = createOwner();
  const [state] = createStore(initialValue as T);

  if (options?.ssrSource === "client") {
    return state;
  }

  let disposed = false;
  // On the creation context, not `owner` — retry resets `owner` (#2900).
  onCleanup(() => {
    disposed = true;
  });

  const ssrSource = options?.ssrSource;
  const useProxy = ssrSource !== "hybrid";
  const patches: PatchOp[] = [];
  const draft = useProxy ? createDeepProxy(state as any, patches) : (state as any as T);

  const runProjection = () => {
    resetOwnerForRerun(owner);
    return runWithOwner(owner, () => fn(draft));
  };
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  try {
    result = runProjection();
  } catch (error) {
    if (!(error instanceof NotReadyError)) throw error;

    const deferred = createDeferredPromise<T>();
    const [pending, markReady] = createPendingProxy(state, deferred.promise);
    settleServerAsync<void | T, T>(
      Promise.reject(error),
      () => runProjection() as void | T | PromiseLike<void | T>,
      deferred,
      (value: void | T) => {
        if (value !== undefined && value !== state && value !== draft) {
          Object.assign(state, value);
        }
        markReady();
        return state as T;
      },
      (_error: any) => {
        markReady();
      },
      () => disposed
    );
    if (ctx?.async && !getContext(NoHydrateContext) && owner.id)
      ctx.serialize(owner.id, deferred.promise, options?.deferStream);
    return pending;
  }

  // Async iterable (generator)
  const iteratorFn = (result as any)?.[Symbol.asyncIterator];
  if (typeof iteratorFn === "function") {
    if (ssrSource === "hybrid") {
      let currentResult = result;
      let iter: AsyncIterator<void | T>;
      const deferred = createDeferredPromise<T>();
      const [pending, markReady] = createPendingProxy(state, deferred.promise);
      const runFirst = () => {
        const source = currentResult ?? runProjection();
        currentResult = undefined;
        const nextIterator = (source as any)?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createProjection");
        }
        iter = nextIterator.call(source);
        return iter.next().then((r: IteratorResult<void | T>) => {
          if (!r.done) closeAsyncIterator(iter);
          return r.value as T;
        });
      };
      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        (value: void | T) => {
          if (value !== undefined && value !== state) {
            Object.assign(state, value);
          }
          markReady();
          return state as T;
        },
        (error: any) => {
          markReady();
        },
        () => disposed
      );
      if (ctx?.async && !getContext(NoHydrateContext) && owner.id)
        ctx.serialize(owner.id, deferred.promise, options?.deferStream);
      return pending;
    } else {
      // Full streaming: eagerly start first iteration. Tapped wrapper replays
      // first value as full state snapshot, then yields patch batches.
      let currentResult = result;
      let iter: AsyncIterator<void | T>;
      let firstResult: IteratorResult<void | T> | undefined;
      const deferred = createDeferredPromise<void>();
      const [pending, markReady] = createPendingProxy(state, deferred.promise);
      const runFirst = () => {
        const source = currentResult ?? runProjection();
        currentResult = undefined;
        const nextIterator = (source as any)?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createProjection");
        }
        iter = nextIterator.call(source);
        return iter.next().then((value: IteratorResult<void | T>) => {
          firstResult = value;
          return Promise.resolve();
        });
      };

      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        () => {
          patches.length = 0;
          const resolved = firstResult;
          if (
            resolved &&
            !resolved.done &&
            resolved.value !== undefined &&
            resolved.value !== draft
          ) {
            Object.assign(state, resolved.value as T);
          }
          // Lock SSR-visible state at V1: subsequent generator mutations update
          // `state` (for draft/patch correctness) but reads go through the frozen copy.
          markReady(JSON.parse(JSON.stringify(state)) as T);
          return undefined;
        },
        (error: any) => {
          markReady();
        },
        () => disposed
      );

      if (ctx?.async && !getContext(NoHydrateContext) && owner.id) {
        let tappedFirst = true;
        const tapped = {
          [Symbol.asyncIterator]: () => ({
            next() {
              if (tappedFirst) {
                tappedFirst = false;
                return deferred.promise.then(() => {
                  if (firstResult?.done) return { done: true as const, value: undefined };
                  return { done: false as const, value: JSON.parse(JSON.stringify(state)) };
                });
              }
              return iter.next().then((r: IteratorResult<void | T>) => {
                if (disposed) return { done: true as const, value: undefined };
                const flushed = patches.splice(0);
                if (!r.done) {
                  if (r.value !== undefined && r.value !== draft) {
                    Object.assign(state, r.value as T);
                  }
                  return { done: false as const, value: flushed };
                }
                return { done: true as const, value: undefined };
              });
            },
            return(value?: any) {
              return iter.return?.(value);
            }
          })
        };
        ctx.serialize(owner.id, tapped, options?.deferStream);
      }
      return pending;
    }
  }

  if (isThenable<T>(result)) {
    const deferred = createDeferredPromise<T>();
    const [pending, markReady] = createPendingProxy(state, deferred.promise);
    settleServerAsync(
      result,
      () => runProjection() as void | T | PromiseLike<void | T>,
      deferred,
      (value: void | T) => {
        if (value !== undefined && value !== state) {
          Object.assign(state, value);
        }
        markReady();
        return state as T;
      },
      (error: any) => {
        markReady();
      },
      () => disposed
    );
    if (ctx?.async && !getContext(NoHydrateContext) && owner.id)
      ctx.serialize(owner.id, deferred.promise, options?.deferStream);
    return pending;
  }

  // Synchronous: fn either mutated state directly (void) or returned a new value
  if (result !== undefined && result !== state && result !== draft) {
    Object.assign(state, result as T);
  }
  return state;
}

export function reconcile<T extends U, U extends object>(value: T): (state: U) => T {
  return state => {
    if (!isWrappable(state) || !isWrappable(value)) return value;
    const targetKeys = Object.keys(value) as (keyof T)[];
    const previousKeys = Object.keys(state) as (keyof T)[];
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      const key = targetKeys[i];
      setProperty(state, key, value[key]);
    }
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (value[previousKeys[i]] === undefined) setProperty(state, previousKeys[i], undefined);
    }
    return state as T;
  };
}

export function deep<T extends object>(store: Store<T>): Store<T> {
  return store;
}

function proxySource(read: Accessor<any>) {
  return new Proxy({} as any, {
    get(_, property, receiver) {
      if (property === $PROXY) return receiver;
      const source = read() || {};
      return source[property];
    },
    has(_, property) {
      if (property === $PROXY) return true;
      return property in (read() || {});
    },
    ownKeys() {
      return Object.keys(read() || {});
    },
    getOwnPropertyDescriptor(_, property) {
      return {
        configurable: true,
        enumerable: true,
        get() {
          return (read() || {})[property];
        }
      };
    }
  });
}

export function merge<T extends unknown[]>(...sources: T): Merge<T> {
  for (let i = 0; i < sources.length; i++) {
    if (typeof sources[i] === "function") {
      sources[i] = proxySource(createMemo(sources[i] as () => any)) as T[number];
    }
  }
  return signalMerge(...sources) as Merge<T>;
}

// === Array mapping ===

export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: T, i: Accessor<number>) => U,
  options?: { keyed?: true; fallback?: Accessor<any> }
): () => U[];
export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: number) => U,
  options: { keyed: false; fallback?: Accessor<any> }
): () => U[];
export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: Accessor<number>) => U,
  options: { keyed: (item: T) => any; fallback?: Accessor<any> }
): () => U[];
export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn:
    | ((v: T, i: Accessor<number>) => U)
    | ((v: Accessor<T>, i: number) => U)
    | ((v: Accessor<T>, i: Accessor<number>) => U),
  options: { keyed?: boolean | ((item: T) => any); fallback?: Accessor<any> } = {}
): () => U[] {
  const indexes = mapFn.length > 1;
  // SSR-only optimization: rows reuse the memo owner — no per-row owner
  // allocation, no per-row linked-list link, no per-row dispose walk.
  //
  // Per-row id parity with the client is preserved by *mutating* the memo
  // owner's `id` and resetting `_childCount` for each iteration. Any nested
  // `createOwner` (compiler-emitted memos, providers, boundaries) under the
  // row sees the synthetic row id as its parent prefix — the exact id the
  // client produces from its real per-row owner. After the loop, the memo
  // owner is restored and `_childCount` is advanced so siblings after `<For>`
  // pick up the right next id.
  //
  // Safe because:
  //  * `mapFn` runs once per render — never re-runs in isolation. Any sync
  //    `NotReadyError` propagates up through this `sync: true` createMemo
  //    (which doesn't latch) and the engine reruns the whole `mapArray` with
  //    fresh state.
  //  * Async retries always live in their own nested owners (compiler-emitted
  //    sync memos, `_$memo()`, boundaries). Their ids and captured state are
  //    snapshotted at owner-creation time, so restoring `parent.id` afterwards
  //    doesn't disturb them.
  const parent = currentOwner;
  const read = createMemo(
    () => {
      const items = list();
      const s: U[] = [];
      if (items && items.length) {
        const parent = currentOwner!;
        const origId = parent.id;
        const origChildCount = parent._childCount;
        try {
          for (let i = 0, len = items.length; i < len; i++) {
            if (origId !== undefined) {
              parent.id = formatChildId(origId, origChildCount + i);
            }
            parent._childCount = 0;
            s.push(
              options.keyed === false
                ? indexes
                  ? (mapFn as (v: Accessor<T>, i: number) => U)(() => items[i], i)
                  : (mapFn as (v: Accessor<T>) => U)(() => items[i])
                : typeof options.keyed === "function"
                  ? indexes
                    ? (mapFn as (v: Accessor<T>, i: Accessor<number>) => U)(
                        () => items[i],
                        () => i
                      )
                    : (mapFn as (v: Accessor<T>) => U)(() => items[i])
                  : indexes
                    ? (mapFn as (v: T, i: Accessor<number>) => U)(items[i], () => i)
                    : (mapFn as (v: T) => U)(items[i])
            );
          }
        } finally {
          parent.id = origId;
          parent._childCount = origChildCount + items.length;
        }
      } else if (options.fallback) {
        const fo = createOwner();
        s.push(runWithOwner(fo, () => options.fallback!()) as U);
      }
      return s;
    },
    { sync: true }
  );
  consumeClientComputedSlot(parent);
  return read;
}

export function repeat<T>(
  count: Accessor<number>,
  mapFn: (i: number) => T,
  options: { fallback?: Accessor<any>; from?: Accessor<number | undefined> } = {}
): () => T[] {
  // See mapArray — same per-row owner elision via id mutation.
  const parent = currentOwner;
  const read = createMemo(
    () => {
      const len = count();
      const offset = options.from?.() || 0;
      if (!len) {
        if (!options.fallback) return [];
        const fo = createOwner();
        return [runWithOwner(fo, () => options.fallback!()) as T];
      }
      const out: T[] = new Array(len);
      const parent = currentOwner!;
      const origId = parent.id;
      const origChildCount = parent._childCount;
      try {
        for (let i = 0; i < len; i++) {
          if (origId !== undefined) {
            parent.id = formatChildId(origId, origChildCount + i);
          }
          parent._childCount = 0;
          out[i] = mapFn(i + offset);
        }
      } finally {
        parent.id = origId;
        parent._childCount = origChildCount + len;
      }
      return out;
    },
    { sync: true }
  );
  consumeClientComputedSlot(parent);
  return read;
}

// === Boundary primitives ===

const ErrorContext: Context<((err: any) => void) | null> = {
  id: Symbol("ErrorContext"),
  defaultValue: null
};

export { ErrorContext };

// --- Reveal SSR coordination ---
// Lives here (not flow.ts, where the Reveal plumbing consumes it) so both
// boundary implementations can sever it without circular imports.

export type ServerRevealGroup = {
  id: string;
  /**
   * Register a child fragment (Loading) or composite child (inner Reveal).
   * Returns `collapseFallback` (hide fallback visually, used for collapsed-sequential
   * tail) and `held` (stash `revealFragments` swaps until the parent releases us).
   * `held` only applies when the caller is a nested Reveal — Loadings ignore it.
   */
  register(
    key: string,
    options?: { onActivate?: () => void }
  ): { collapseFallback: boolean; held: boolean };
  /** Called by a child when its subtree is fully resolved, which also implies minimal readiness. */
  onResolved(key: string): void;
  /**
   * Called by a nested Reveal when it becomes "minimally resolved" under its own
   * order (together: fully resolved; sequential: first registered fragment resolved;
   * natural: any fragment resolved). Loadings don't fire this — their `onResolved`
   * implies minimal readiness at the same time.
   */
  onMinimallyResolved?(key: string): void;
};

export const RevealGroupContext: Context<ServerRevealGroup | null> = {
  id: Symbol("RevealGroupContext"),
  defaultValue: null
};

export function runWithBoundaryErrorContext<T>(
  owner: Owner,
  render: () => T,
  onError: (err: any, parentHandler: ((err: any) => void) | null) => void,
  context?: NonNullable<typeof sharedConfig.context>,
  boundaryId?: string
): T {
  const prevCtx = sharedConfig.context;
  const prevBoundary = context?._currentBoundaryId;
  if (context) {
    sharedConfig.context = context;
    if (boundaryId !== undefined) context._currentBoundaryId = boundaryId;
  }
  try {
    return runWithOwner(owner, () => {
      const parentHandler = getContext(ErrorContext);
      setContext(ErrorContext, err => onError(err, parentHandler));
      return render();
    }) as T;
  } finally {
    if (context) {
      if (boundaryId !== undefined) context._currentBoundaryId = prevBoundary;
      sharedConfig.context = prevCtx;
    }
  }
}

export { NoHydrateContext };

export function createErrorBoundary<T, U>(
  fn: () => T,
  fallback: (error: Accessor<unknown>, reset: () => void) => U
): Accessor<T | U> {
  const ctx = sharedConfig.context;
  const parent = getOwner();
  const owner = createOwner();
  // Boundaries sever reveal-group coordination for their subtree (see
  // ssrLoadingBoundary): an Errored-wrapped Loading must not delay the
  // ancestor group's release (#2872).
  setContext(RevealGroupContext, null, owner);
  const outputOwner = ctx ? createOwner() : undefined;
  // Partial template from a pass that went async. A retry pull must resume
  // these surviving holes (their owners and any async computations created
  // inside the boundary stay alive) rather than dispose and re-run the
  // children — re-running would recreate the async work from scratch, which
  // is pending again on every pass and can never settle (#2809 SSR loop).
  let pending: { t: string[]; h: Function[]; p: Promise<any>[] } | undefined;
  const resolve = () => {
    const resolved: any = pending
      ? ctx!.ssr(pending.t, ...pending.h)
      : ctx!.resolve(runWithOwner(createOwner(), fn));
    pending = resolved?.p?.length ? resolved : undefined;
    if (pending) throw new NotReadyError(Promise.all(pending.p));
    return resolved;
  };
  const renderFallback = (err: any) =>
    ctx
      ? runWithOwner(parent!, () => {
          return runWithOwner(outputOwner!, () =>
            fallback(
              () => err,
              () => {}
            )
          );
        })
      : fallback(
          () => err,
          () => {}
        );
  const serializeError = (err: any) => {
    if (ctx && owner.id && !runWithOwner(owner, () => getContext(NoHydrateContext))) {
      ctx.serialize(owner.id, err);
    }
  };
  const handleError = (err: any) => {
    serializeError(err);
    return renderFallback(err);
  };
  return () => {
    let result: any;
    let handled = false;
    // Disposing while resuming would tear down the very computations the
    // stashed holes read from (marking them disposed drops their settlement).
    if (ctx && !pending) disposeOwner(owner, false);
    try {
      result = ctx
        ? runWithBoundaryErrorContext(owner, resolve, err => {
            if (err instanceof NotReadyError) throw err;
            handled = true;
            result = handleError(err);
            throw err;
          })
        : runWithOwner(owner, fn);
    } catch (err) {
      if (err instanceof NotReadyError) throw err;
      pending = undefined;
      result = handled ? result : handleError(err);
    }
    return result;
  };
}

export function createLoadingBoundary<T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
): Accessor<T | U> {
  // On server, try to run fn. If NotReadyError is thrown, return fallback.
  // Full HydrationContext integration happens in the Loading component wrapper.
  try {
    const result = fn();
    return () => result;
  } catch (err) {
    if (err instanceof NotReadyError) {
      return () => fallback();
    }
    throw err;
  }
}

export type RevealOrder = "sequential" | "together" | "natural";

export function createRevealOrder<T>(
  fn: () => T,
  _options?: {
    order?: () => RevealOrder;
    collapsed?: () => boolean;
  }
): T {
  const o = createOwner();
  return runWithOwner(o, fn);
}

// === Utilities ===

export function untrack<T>(fn: () => T): T {
  return fn();
}

export function flush() {}

export function resolve<T>(fn: () => T): Promise<T> {
  throw new Error("resolve is not implemented on the server");
}

export function isPending(fn: () => any): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    if (err instanceof NotReadyError) throw err;
    return false;
  }
}

export function latest<T>(fn: () => T): T {
  return fn();
}

export function refresh<T>(_target: Refreshable<T>): void {
  return undefined;
}

export function affects(_target: unknown, _key?: PropertyKey): void {
  return undefined;
}

export function action<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

export function onSettled(callback: () => void | (() => void)): void {
  // No-op on server, but allocate computation ID for hydration tree alignment
  // (on the client, onSettled calls createTrackedEffect which allocates an ID)
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
}

// NoInfer utility type (also re-exported from signals, but define for local use)
type NoInfer<T extends any> = [T][T extends any ? 0 : never];
