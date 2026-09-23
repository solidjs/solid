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
  TimeoutError,
  isEqual,
  isWrappable,
  SUPPORTS_PROXY,
  enableExternalSource,
  enforceLoadingBoundary
} from "@solidjs/signals";

export { flatten } from "@solidjs/signals";
export { snapshot, omit, storePath, isStatic, $PROXY, $TRACK } from "@solidjs/signals";

// === Type re-exports ===

import type {
  Accessor as SignalAccessor,
  ProjectionOptions,
  Refreshable,
  StoreOptions
} from "@solidjs/signals";

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
import {
  IS_DEV,
  IS_OBSERVE,
  devCheck,
  emitFinding,
  errorText,
  recordFinding
} from "./diagnostics.js";
import type { DiagnosticSubject } from "@solidjs/signals";

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
// Compared to the upstream `Owner` shape (~14 fields), `SSROwner` carries 10
// — no `_queue`, `_pendingDisposal`, `_pendingFirstChild`, `_prevSibling`,
// `_config`, `_snapshotScope`, `_flags`. Smaller object → less per-render
// allocation and faster GC.

type Disposable = () => void;

interface SSROwner {
  /**
   * The hydration id, or — while `_scopeSlot >= 0` — the PREFIX of a
   * pending one (see `ssrScope`). Read it for id derivation only through
   * `materializeId` / `ownerId`, never directly.
   */
  id?: string;
  _transparent: boolean;
  _disposal: Disposable | Disposable[] | null;
  _parent: SSROwner | null;
  _context: Record<symbol | string, unknown>;
  _childCount: number;
  _firstChild: SSROwner | null;
  _nextSibling: SSROwner | null;
  _disposed: boolean;
  /**
   * A reserved-but-unformatted hole slot (`ssrScope`), or -1. While a hole
   * scope is swapped onto this owner, its id is the pair (`id` = the
   * enclosing owner's id, `_scopeSlot` = the slot the hole reserved) and
   * the string `formatChildId(id, _scopeSlot)` is only built on demand —
   * a text hole never asks for one. Owned by the swap: set and restored
   * around every evaluation; -1 in every literal and on pool reuse.
   */
  _scopeSlot: number;
  /**
   * Observe/dev tiers only: the label the core's `ownerPath` walk reads
   * (`<Name>` on a component's owner — see `createComponentOwner`), the
   * same field and the same walk as client owners, so a server finding
   * locates itself as `<App> › <Page>` without the core learning this
   * shape. Prod owners never carry the slot (a second literal, like the
   * signals node shapes), so the 10-field layout above is untouched there.
   */
  _name?: string;
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

/**
 * The owner's id, folding a pending hole slot (`ssrScope`) into it on first
 * demand: `id` becomes `formatChildId(prefix, slot)` — the exact string the
 * eager reservation used to build up front — and the slot clears. Every read
 * that DERIVES from an owner's id (a child id, a transparent child's copy)
 * goes through here, so a scoped text hole that never derives anything
 * never pays for the string. Idempotent; the string is byte-identical
 * whenever it is built.
 */
function materializeId(owner: SSROwner): string | undefined {
  if (owner._scopeSlot >= 0) {
    owner.id = formatChildId(owner.id!, owner._scopeSlot);
    owner._scopeSlot = -1;
  }
  return owner.id;
}

/**
 * The owner's id for a reader that is NEVER a pending hole scope — its own
 * freshly created owner (boundaries, rows, Reveal, an async node's
 * serialization key). The direct field read is the prod build; the dev
 * build asserts the premise, so a future reader that lands on a swapped
 * owner fails loudly instead of deriving from the bare prefix. Readers that
 * CAN see a pending owner use `materializeId`.
 */
export function ownerId(owner: Owner | SSROwner): string | undefined {
  const o = owner as unknown as SSROwner;
  if (IS_DEV && o._scopeSlot >= 0) {
    throw new Error(
      "Internal: read of a hole-scoped owner's id without materializing it — use materializeId"
    );
  }
  return o.id;
}

function nextChildIdFor(owner: SSROwner, consume: boolean): string {
  let counter = owner;
  while (counter._transparent && counter._parent) counter = counter._parent;
  if (counter.id != null) {
    const prefix = counter._scopeSlot >= 0 ? materializeId(counter)! : counter.id;
    return formatChildId(prefix, consume ? counter._childCount++ : counter._childCount);
  }
  throw new Error("Cannot get child id from owner without an id");
}

export function getNextChildId(owner: Owner): string {
  return nextChildIdFor(owner as unknown as SSROwner, true);
}

export function peekNextChildId(owner: Owner): string {
  return nextChildIdFor(owner as unknown as SSROwner, false);
}

/**
 * Dev only — installed as `sharedConfig.devPeekNextContextId`, never
 * exported from the entry (the prod and observe artifacts carry none of it).
 * The id the NEXT child of the current owner would take, read with no side
 * effect: a pending hole slot (`ssrScope`) is folded into the prefix
 * arithmetically — the same string `materializeId` would build — without
 * materializing it onto the owner. `undefined` outside an id-carrying tree.
 * `@solidjs/web` snapshots it around an unscoped hole's evaluation: a hole
 * that moved it took ids from the enclosing counter, which the client
 * allocates at a different time (`UNSCOPED_HOLE_ALLOCATED_IDS`).
 */
export function devPeekNextChildId(): string | undefined {
  let counter = currentOwner;
  if (!counter) return undefined;
  while (counter._transparent && counter._parent) counter = counter._parent;
  if (counter.id == null) return undefined;
  const prefix =
    counter._scopeSlot >= 0 ? formatChildId(counter.id, counter._scopeSlot) : counter.id;
  return formatChildId(prefix, counter._childCount);
}

// Monotonic count of owner creations in this process — the reactive-scope
// creation stamp. The live-hole engine (`@solidjs/web` server runtime)
// diffs it around a hole evaluation to detect render-once work: memos,
// boundaries, and stateful components all allocate owners, so a hole whose
// evaluation moves this stamp is not safely re-runnable and latches instead
// of opening a live binding. Process-global is sufficient: the diff spans
// one synchronous evaluation, which nothing interleaves.
let ownerCreations = 0;

/** The reactive-scope creation stamp (see `ownerCreations`). */
export function creationStamp(): number {
  return ownerCreations;
}

export function createOwner(options?: { id?: string; transparent?: boolean }): Owner {
  ownerCreations++;
  const transparent = options?.transparent ?? false;
  return allocateOwner(options?.id, transparent) as unknown as Owner;
}

/**
 * Observe/dev tiers: the transparent, labelled owner a component body runs
 * under, so the owner tree reads as the component tree — the server twin of
 * the client's `observedComponent` root. Transparent, so it consumes no
 * hydration id (ids keep walking up to the enclosing id-bearing owner).
 * NOT counted in `creationStamp()`: the live-hole engine reads that stamp
 * to tell render-once work from re-runnable holes, and a label must not
 * change that verdict between tiers — a component that latches in the
 * observe tier and binds live in prod would be a tier-dependent render.
 * Never called from the prod build.
 */
export function createComponentOwner(name: string): Owner {
  const owner = allocateOwner(undefined, true);
  owner._name = name;
  return owner as unknown as Owner;
}

function allocateOwner(explicitId: string | undefined, transparent: boolean): SSROwner {
  const parent = currentOwner;
  // A transparent child COPIES the parent's id (ids keep walking up to it),
  // so a pending hole slot on the parent must be folded in first — the copy
  // is read directly later (an async node's serialization key).
  const id =
    explicitId ??
    (transparent
      ? parent && parent._scopeSlot >= 0
        ? materializeId(parent)
        : parent?.id
      : parent?.id != null
        ? nextChildIdFor(parent, true)
        : undefined);
  const ctx = parent?._context ?? defaultSSRContext;
  let owner: SSROwner;
  if (ownerPool.length) {
    // Reuse a recycled owner. Reset all fields so the hidden class stays
    // monomorphic and we don't carry stale references. (Allocation is the
    // hot path — re-initializing 10 slots is much cheaper than `new`.)
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
    owner._scopeSlot = -1;
    if (IS_OBSERVE) owner._name = undefined;
  } else {
    // Two literals, one per tier: the observe/dev shape carries the label
    // slot so every owner of the tier shares a hidden class (a pooled
    // component owner reused as a plain one included); prod's 10-field
    // literal is the same shape in every allocation site.
    owner = IS_OBSERVE
      ? {
          id,
          _transparent: transparent,
          _disposal: null,
          _parent: parent,
          _context: ctx,
          _childCount: 0,
          _firstChild: null,
          _nextSibling: null,
          _disposed: false,
          _scopeSlot: -1,
          _name: undefined
        }
      : {
          id,
          _transparent: transparent,
          _disposal: null,
          _parent: parent,
          _context: ctx,
          _childCount: 0,
          _firstChild: null,
          _nextSibling: null,
          _disposed: false,
          _scopeSlot: -1
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
  return owner;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner as unknown as SSROwner | null;
  try {
    return fn();
  } catch (error) {
    stampThrower(error, owner);
    throw error;
  } finally {
    currentOwner = prev;
  }
}

/**
 * Where an error was THROWN, for the server error hook and the findings: the
 * innermost owner whose scope it escaped — stamped at the first owner scope
 * it crosses (component bodies and effects run through `runWithOwner`, a
 * memo's pull through its inlined twin), kept as it propagates to the
 * boundary that meets it. Object errors only; a `NotReadyError` is the
 * engine's own signal, not a failure.
 */
const throwers = new WeakMap<object, Owner>();
function stampThrower(error: unknown, owner: Owner | null): void {
  if (owner === null || !isObject(error) || error instanceof NotReadyError) return;
  if (!throwers.has(error)) throwers.set(error, owner);
}
/** @internal The owner `error` was stamped as thrown under, if it crossed one. */
export function throwerOf(error: unknown): Owner | undefined {
  return isObject(error) ? throwers.get(error) : undefined;
}

export function getOwner(): Owner | null {
  return currentOwner as unknown as Owner | null;
}

export function isDisposed(owner: Owner): boolean {
  return (owner as unknown as SSROwner)._disposed;
}

/**
 * Server mirror of `onCleanup`. Cleanups run in unwind order: an owner's
 * children are disposed before its own cleanups, and within one owner later
 * registrations run before earlier ones (see `disposeOwner`).
 */
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
 * in unwind order (later registrations first) and resets `_firstChild` /
 * `_childCount`.
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
      node._scopeSlot = -1;
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
  // Defensive: a kept-alive owner (`self=false`) re-runs from its own,
  // settled id. The slot is swap-owned (`ssrScope` restores it in `finally`),
  // so this is never observed set here — pinned by `ownerId`'s dev check.
  node._scopeSlot = -1;
  // Detached before it runs, mirroring the client `runDisposal` (#3601): a
  // cleanup that re-enters this owner's disposal must find nothing to re-run.
  const d = node._disposal;
  node._disposal = null;
  if (d) {
    if (Array.isArray(d)) {
      // Unwind order, mirroring the client `runDisposal` (#3572): later
      // registrations run before earlier ones.
      for (let i = d.length - 1; i >= 0; i--) d[i]();
    } else {
      d();
    }
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
  node._scopeSlot = -1;
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
 *
 * The swapped owner is the nearest ID-BEARING one, not necessarily the
 * current one: content created inside the hole reads its ids through
 * `nextChildIdFor`, which walks up past transparent owners, so a swap on a
 * transparent owner (the server-component scope owner; in observe/dev, the
 * labelled `<Name>` owner every component body runs under) would be
 * invisible to it and the hole's content would take fresh ids from the
 * enclosing counter — a different id than the client, which scopes the
 * hole by its own insert effect regardless of what sits between.
 *
 * The reservation is a counter increment; the scope's id STRING is not
 * built here. Most scoped holes are text (`{row.label}` — since #3599 every
 * hole that is not provably primitive is scoped) and nothing inside them
 * ever asks for a child id, so formatting `prefix + slot` up front was the
 * dominant per-hole cost. Instead the swap installs the pair
 * (`id = prefix`, `_scopeSlot = slot`) and `materializeId` folds it into the
 * string on the first derivation — the same string the eager form built.
 * `prefix` is the enclosing owner's id at reservation time, materialized
 * once if that owner is itself a pending scope (a hole inside a hole).
 */
export function ssrScope<T>(fn: () => T): () => unknown {
  let parent = currentOwner;
  // No id plumbing to protect (non-hydrating SSR / owner-less evaluation).
  if (!parent || parent.id == null) return fn;
  while (parent._transparent && parent._parent) parent = parent._parent;
  const prefix = parent._scopeSlot >= 0 ? materializeId(parent)! : parent.id!;
  const slot = parent._childCount++;
  return () => {
    const prevId = parent.id;
    const prevSlot = parent._scopeSlot;
    const prevCount = parent._childCount;
    parent.id = prefix;
    parent._scopeSlot = slot;
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
      parent._scopeSlot = prevSlot;
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
  // Per-epoch caching for frame renders (DR-2 case 1): `sync` marks a
  // compute whose last result was a plain synchronous value — the only kind
  // a commit can invalidate (async results advance through their own settle
  // machinery and must NOT be re-run, which would mint new promises /
  // iterators). `epoch` is the commit epoch the value was computed at; a
  // read at a later epoch recomputes. Absent outside frame renders — the
  // hook (`ctx.commitEpoch`) only exists where a binding ledger is live.
  sync?: boolean;
  epoch?: number;
}

/**
 * Live-source brand (registered symbol — set by the transport's `live()`
 * declaration in `@solidjs/web`; registered so separately bundled
 * copies agree). A branded iterable is a STANDING ANSWER — every yield is
 * the complete current value and the source re-yields current state on any
 * invocation — not a bounded trace whose completion ends the response.
 * That contract is what makes the auto-hybrid policy below sound: taking
 * the first value and closing loses nothing the client can't re-ask for.
 */
const LIVE_SOURCE = Symbol.for("solid.LiveSource");

type SsrSourceMode = "server" | "hybrid" | "client";
interface ServerProjectionOptions extends ProjectionOptions {
  deferStream?: boolean;
  ssrSource?: SsrSourceMode;
}
type ServerMemoOptions<T> = MemoOptions<T> & {
  /**
   * Keep this value out of the hydration payload. The subtree still hydrates;
   * the client is expected to RECOMPUTE the value instead of reading it back.
   * Only correct where recomputation is intended — see processResult.
   *
   * @internal
   */
  serialize?: false;
};
type ServerSignalOptions<T> = SignalOptions<T>;
type NoFn<T> = T extends Function ? never : T;

/**
 * The pending source for BARE `ssrSource: "client"` (no declared commit #0):
 * a hole the server can never fill. Reads throw a `NotReadyError` carrying
 * this promise; the `$clientHole` tag classifies the suspension as FINAL —
 * boundaries hand the position to the client (the "$$f" client-continue
 * route) instead of awaiting a settle that will never come. One shared,
 * never-settling instance: retry subscriptions attached to it (e.g.
 * `subscribePendingRetry`) are inert by design.
 */
const CLIENT_HOLE: Promise<never> = /* @__PURE__ */ Object.assign(new Promise<never>(() => {}), {
  $clientHole: true
});

/**
 * A final (client-hole) suspension is only meaningful where a `<Loading>`
 * boundary can catch it and take the client-continue route. Read outside a
 * Loading discovery pass (`_loadingPhase`), it would wedge the stream as an
 * unresolvable top-level hole — throw a real error instead, loudly.
 */
function clientHoleRead(): never {
  if (!(sharedConfig.context as any)?._loadingPhase) {
    const message =
      `[ASYNC_OUTSIDE_LOADING_BOUNDARY] ssrSource: "client" read during SSR outside a <Loading> ` +
      `boundary — the server cannot run this source, so a boundary must own the position's ` +
      `fallback. Wrap the read in <Loading>, or declare a loadingValue/seedLoadingValue to ` +
      `render a provisional value instead.`;
    // The client's code for the same rule; `side` tells the two apart. The
    // site throws (this is a hard error in every tier), so the record is
    // wiring, not a console report — the throw is the console face.
    if (IS_OBSERVE)
      recordFinding({
        code: "ASYNC_OUTSIDE_LOADING_BOUNDARY",
        kind: "async",
        severity: "error",
        message,
        data: { side: "server" }
      });
    throw new Error(message);
  }
  throw new NotReadyError(CLIENT_HOLE);
}

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
  // Observed at birth. This deferred is an internal channel: its outcome is
  // always mirrored where it matters (`comp.error`, the slot record, the
  // guarded serialized promise), and `settleServerAsync` settles it
  // unconditionally — a serialized flight must land whatever the node's
  // lifetime. But not every flight has a consumer: under renderToString
  // there is no serialization channel (`ctx.async` unset) and the sync
  // `<Loading>` path never awaits the NotReadyError's source; a
  // NoHydration zone or `serialize: false` opts out of the stream; an
  // unread source has no reader at all. There, a terminal rejection landed
  // on a promise with zero subscribers — an unhandledRejection that took
  // the process down after the HTML had already been returned (#3570).
  // A no-op rejection arm is a separate derived promise: real subscribers
  // still see the rejection exactly as before.
  promise.then(undefined, () => {});

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

/**
 * By-slot flight memory for retry convergence (#3003) — see the adoption
 * site in `processResult`. Keyed weakly by the render context object the node
 * captured at creation (a boundary's buffered ctx or the render root): the
 * same scope its re-creations run in, so concurrent renders never share and
 * entries die with the render. States mirror the promise stamp — `s: 1`
 * fulfilled / `s: 2` rejected with `v` payload — plus `s: 0` for a flight
 * still in the air, carrying the deferred so re-creations of the slot share
 * one serialized promise instead of planting a fresh one per pass.
 */
type SlotRecord = { s: 0 | 1 | 2; v: any; d: DeferredPromise<any> | undefined };
// Stored as a symbol-keyed property ON the context object rather than a
// WeakMap<ctx, Map> — same lifetime (dies with the render) and same identity
// key (a node's re-creations run under the same buffered ctx object), but
// the hot path allocates one plain object per ctx instead of a WeakMap entry
// plus a Map, and settle transitions mutate the record in place (single
// {s,v,d} shape) instead of allocating a fresh entry per state change —
// recordSlot was the top allocation site in shell profiles (#stage-4 §15).
// Context clones (spread copies) share the parent's store by reference,
// which is safe: owner ids are unique per render, so keys cannot collide.
const SLOTS = /* @__PURE__ */ Symbol("settledSlots");
// Projection flavor of the slot store (#3068): id → the pending-proxy store
// returned by an async `createProjection` at that slot, so re-creations
// across retry passes join the in-flight instance instead of allocating a
// fresh one per pass. Same lifetime and keying rationale as SLOTS above.
const PROJECTION_SLOTS = /* @__PURE__ */ Symbol("projectionSlots");

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
        // No disposal guard: the deferred may be serialized into the stream
        // (and shared across slot re-creations), so a known answer must land
        // regardless of this node's lifetime — an unresolved serialized
        // promise holds the response open forever. Mutating a disposed comp
        // is inert; slot recording wants the answer either way.
        deferred.resolve(onSuccess(value));
      },
      error => {
        // NotReady defers to the retry chain (`attempt` no-ops once disposed —
        // a re-created node joins the flight and drives the shared deferred).
        // Terminal errors settle unconditionally, same as the success path.
        if (subscribePendingRetry(error, attempt)) return;
        onError(error);
        deferred.reject(error);
      }
    );
  };

  attempt();
}

// === Reactive Primitives (pull-based) ===

// --- Server write deprecation -----------------------------------------------
//
// Server render is pure: change enters through async sources, never setters.
// Setter calls are tolerated this release (signal/store writes land as inert
// data, optimistic writes are no-ops) but deprecated on the way to throwing —
// see RFC 11's server mutation policy. Warned once per process per category
// so subscription-driven writes can't flood server logs. A dev check
// (`SERVER_WRITE`, server-dev-build-plan D1): the deprecation notice is a
// developer's concern, so the observe and prod artifacts carry neither the
// check nor the text — before the server dev build existed this fired in
// production by accident of having no gate.
const warnedServerWrites = new Set<string>();
function warnServerWrite(category: "signal" | "store" | "optimistic"): void {
  if (!IS_DEV) return;
  if (warnedServerWrites.has(category)) return;
  warnedServerWrites.add(category);
  const message =
    category === "optimistic"
      ? "[SERVER_WRITE] Optimistic writes are inert on the server and will become an error. " +
        "Optimistic state reverts once the async work it accompanies settles, and server " +
        "output is settled state — optimistic updates only have meaning on the client."
      : category === "store"
        ? "[SERVER_WRITE] Writing a store on the server is deprecated and will become an " +
          "error. Server render is pure: state changes flow from async sources (promises, " +
          "async iterables), never setters — this write landed as inert data (nothing " +
          "re-renders). Derive the store from its source (createStore(fn, seed)) instead " +
          "of writing into it."
        : "[SERVER_WRITE] Writing a signal on the server is deprecated and will become an " +
          "error. Server render is pure: state changes flow from async sources (promises, " +
          "async iterables), never setters — this write landed as inert data (nothing " +
          "re-renders). If you are bridging a subscription, make it the async source " +
          "itself instead of pushing writes from its callback.";
  devCheck({
    code: "SERVER_WRITE",
    kind: "write",
    severity: "warn",
    message,
    data: { category }
  });
}

export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
// Commit #0 (loadingValue) removes the uninitialized window: never undefined
// (the server flushes the loading value even for ssrSource "client"), and
// `prev` is always T — mirrors the client wrapper and the signals core.
export function createSignal<T>(
  fn: ComputeFunction<NoInfer<T>, T>,
  options: ServerSignalOptions<T> & { loadingValue: T }
): Signal<T>;
export function createSignal<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerSignalOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ComputeFunction<any, any>,
  second?: SignalOptions<any>
): Signal<T | undefined> {
  if (typeof first === "function") {
    const hasLoadingValue = second != null && "loadingValue" in (second as any);
    const opts =
      second?.deferStream || second?.ssrSource || hasLoadingValue
        ? {
            deferStream: second?.deferStream,
            ssrSource: second?.ssrSource,
            ...(hasLoadingValue ? { loadingValue: (second as any).loadingValue } : {})
          }
        : undefined;
    const memo = createMemo<T>((prev?: T) => (first as (prev?: T) => T)(prev), opts as any);
    return [
      memo,
      (() => {
        warnServerWrite("signal");
        return undefined;
      }) as Setter<T | undefined>
    ];
  }
  // Plain value form — no ID allocation (IDs are only for owners/computations)
  return [
    () => first as T,
    v => {
      warnServerWrite("signal");
      return ((first as any) = typeof v === "function" ? (v as (prev: T) => T)(first as T) : v);
    }
  ] as Signal<T | undefined>;
}

// Commit #0 (loadingValue): never undefined, `prev` is always T — see
// createSignal. Bare `ssrSource: "client"` (no loadingValue) is the
// structural form: the source suspends server-side as a FINAL hole and the
// nearest <Loading> boundary hands the position to the client.
export function createMemo<T>(
  compute: ComputeFunction<NoInfer<T>, T>,
  options: ServerMemoOptions<T> & { loadingValue: T }
): SourceAccessor<T>;
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerMemoOptions<T>
): SourceAccessor<T>;
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerMemoOptions<T>
): SourceAccessor<T | undefined> {
  // Sync fast path — set by the compiler-emitted `_$memo()` / `_$effect()`
  // wrappers (see `@solidjs/web`'s `render.js`) and by internal control-flow
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
  // Covers createSignal's and createOptimistic's function forms too — both
  // delegate here.
  // Capture SSR context at creation time — async re-computations (via .then callbacks)
  // may run after a concurrent request has overwritten sharedConfig.context.
  const ctx = sharedConfig.context;
  // `options` carries the id plumbing (`id`, `transparent`): the client's
  // inheritId honors both, so dropping them here would consume a child-id
  // slot the client doesn't and shift every sibling hydration id (#3012).
  const owner = createOwner(options);
  // Commit #0 (loadingValue): the server serves the loading value instead of
  // suspending — markup flushes with it, and the landing streams as data for
  // the client to adopt at hydration. `served` flips the moment the loading
  // value becomes the read-visible value; from then on the first-value lock
  // applies (markup rendered from commit #0 keeps reading commit #0) and any
  // landing — even a synchronous one from a NotReady retry — must serialize.
  const loadingState =
    options != null && typeof options === "object" && "loadingValue" in options
      ? { value: (options as any).loadingValue as T, served: false }
      : undefined;
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
  // DEFERRED to first async engagement (async-shaped result or NotReady
  // retry): the flag only guards in-flight async against stale
  // serialization, and eagerly registering a closure per memo taxed every
  // sync-valued memo on the hot creation path. The creation owner is
  // captured by pointer so late arming still lands on the right scope.
  const creationOwner = currentOwner;
  let disposeArmed = false;
  function armDispose() {
    if (disposeArmed) return;
    disposeArmed = true;
    const o = creationOwner;
    if (!o) return;
    const flag = () => {
      comp.disposed = true;
    };
    if (!o._disposal) o._disposal = flag;
    else if (Array.isArray(o._disposal)) o._disposal.push(flag);
    else o._disposal = [o._disposal, flag];
  }

  // Hoisted once — previously re-allocated per update() invocation.
  const run = () => {
    resetOwnerForRerun(owner);
    return runWithOwner(owner, () => runWithObserver(comp, () => comp.compute(comp.value)));
  };

  function update() {
    if (comp.disposed) return;
    try {
      comp.error = undefined;
      comp.errored = false;
      const result = run();
      comp.computed = true;
      // Async-shaped results engage the in-flight machinery — arm the
      // disposal flag before processResult wires continuations. Predicate
      // mirrors processResult's own detection (asyncIterator, thenable).
      if (
        result !== null &&
        typeof result === "object" &&
        (typeof (result as any)[Symbol.asyncIterator] === "function" ||
          typeof (result as any).then === "function")
      )
        armDispose();
      processResult(
        comp,
        result,
        owner,
        ctx,
        options?.deferStream,
        options?.ssrSource,
        run,
        (options as any)?.serialize,
        loadingState
      );
    } catch (err) {
      if (err instanceof NotReadyError) {
        armDispose();
        subscribePendingRetry(err, update);
        if (loadingState) {
          // An unready sync dependency doesn't suspend a loading-value memo:
          // serve commit #0 and let the retry produce the eventual result
          // (which processResult then serializes — the landing is data).
          loadingState.served = true;
          comp.value = loadingState.value;
          comp.error = undefined;
          comp.errored = false;
          comp.computed = true;
          return;
        }
      }
      comp.error = err;
      comp.errored = true;
      comp.computed = true;
    }
  }

  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    // Skip computation. Owner created for ID parity.
    comp.computed = true;
    if (loadingState) {
      // Client-source with commit #0: markup flushes the loading value; the
      // client serves the same value while hydrating, then runs the compute.
      loadingState.served = true;
      comp.value = loadingState.value;
    } else {
      // Bare client source: a FINAL hole (see CLIENT_HOLE). Reads suspend the
      // nearest <Loading> boundary, which hands the position to the client.
      comp.error = new NotReadyError(CLIENT_HOLE);
      comp.errored = true;
    }
  } else if (!options?.lazy) {
    update();
  }

  const read = (() => {
    // Lazy: compute on first read
    if (!comp.computed) {
      update();
    } else if (comp.sync && ctx?.commitEpoch && ctx.commitEpoch() !== comp.epoch) {
      // Per-epoch recompute (frame renders only): a sync-valued memo pulled
      // after a commit re-runs, so a watched slot arg's sweep reads current
      // derivations instead of the first render's cache. Memos are pure by
      // contract — this is the client's source-driven recompute expressed
      // as epoch comparison, no subscriber graph needed.
      update();
    }
    if (comp.errored) {
      // A client hole read outside a Loading discovery pass must fail loudly
      // rather than wedge the stream (see clientHoleRead). Identity check on
      // the shared promise — cost is confined to the error-throw path.
      if ((comp.error as any)?.source === CLIENT_HOLE) clientHoleRead();
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
 *     (`@solidjs/web`'s `render.js`)
 *   - internal control-flow primitives (mapArray, repeat, Show, Switch,
 *     children flatten, lazy outer)
 *
 * Architecture note: SSR retry is owned by the streaming engine, not the
 * memo. When a hole pulls and the body throws `NotReadyError`, the engine
 * pushes the hole back into `result.h`/`result.p` and re-pulls when the
 * source promise resolves (see `resolveSSRNode` in `@solidjs/web`). So
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
  options?: ServerMemoOptions<T>
): SourceAccessor<T | undefined> {
  // Frame renders carry a commit epoch (DR-2 case 1): sync memos cache per
  // epoch there, for-the-render everywhere else. Captured at creation like
  // the async memo's ctx — async continuations may outlive request swaps.
  const ctx = sharedConfig.context;
  // Forward the id plumbing (`id`, `transparent`) like the async path (#3012).
  const owner = createOwner(options);
  let value: T | undefined;
  let error: unknown;
  // Presence flag for `error` — a falsy thrown value is still an error (#2857).
  let errored = false;
  // True iff the next read should return cached state (success or real error).
  // Stays false while `value` reflects a previous successful run AND a later
  // pull is needed (initial: never run; after `NotReadyError`: needs retry).
  let cached = false;
  // The commit epoch `value`/`error` was computed at (frame renders only).
  let epoch: number | undefined;

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
      epoch = ctx?.commitEpoch?.();
      return value;
    } catch (err) {
      if (err instanceof NotReadyError) throw err; // don't latch — engine re-pulls
      stampThrower(err, owner);
      error = err;
      errored = true;
      cached = true;
      epoch = ctx?.commitEpoch?.();
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
    if (cached && (!ctx?.commitEpoch || ctx.commitEpoch() === epoch)) {
      if (errored) throw error;
      return value;
    }
    // Stale epoch (a commit happened since this computed — frame renders
    // only) or never computed: (re)pull. Purity is the memo contract, so an
    // epoch recompute is the client's source-driven re-run, pull-paced.
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
  basePath: PropertyKey[] = [],
  shallow?: boolean
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
      if (!shallow && value !== null && typeof value === "object" && typeof key !== "symbol") {
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
  rerun?: () => any,
  serialize?: boolean,
  loadingState?: { value: T; served: boolean }
) {
  if (comp.disposed) return;
  // The node's own owner, read after its compute unwound — never a swapped
  // hole scope (the swap is restored in `finally` before the result is seen).
  const id = ownerId(owner);
  // Every (re)process resets the sync mark; only the synchronous tail sets
  // it. An epoch recompute that turned async must not stay epoch-cached.
  comp.sync = false;
  // `serialize: false` keeps this value out of the hydration payload while the
  // subtree still hydrates normally — distinct from NoHydrateContext, which
  // opts the whole subtree out (and suppresses the id allocation this needs
  // for client parity). The contract is that the client RECOMPUTES the value,
  // so it is only correct where recomputation is intended: dynamic() re-runs
  // its source and lazy() re-imports its module. Both resolve to component
  // functions, which are not serializable in the first place.
  const noHydrate = serialize === false || getContext(NoHydrateContext, owner);

  // Async-iterable takes precedence over thenable, mirroring the client
  // runtime's detection order (`handleAsync` in @solidjs/signals core/async.ts).
  if (typeof (result as any)?.[Symbol.asyncIterator] !== "function" && isThenable<T>(result)) {
    if ((result as any).s === 1) {
      // Sync-resolved: the window (if any) closes at birth — no loading value
      // ever becomes visible, so normal semantics apply.
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
    if ((result as any).s === 3) {
      // A flattened stream is already consuming this promise's resolution
      // (see the flattening block below): join its deferred. Re-attaching
      // through settleServerAsync would open a SECOND iterator on the same
      // iterable — the stream must have exactly one consumer.
      const d: DeferredPromise<T> = (result as any).d;
      if (loadingState) {
        loadingState.served = true;
        comp.value = loadingState.value;
      } else {
        comp.error = new NotReadyError(d.promise);
        comp.errored = true;
      }
      return;
    }
    // Slot memory (#3003): the retry loops converge by re-running creation
    // scopes, and a re-created node normally adopts its previous answer
    // through the `.s`/`.v` stamp above — which requires the SAME promise
    // object to come back on the rerun. Code that derives a fresh promise
    // per call (`cached.then(...)` — the router's query() does this) defeats
    // the stamp: every pass sees an unstamped pending thenable, throws
    // NotReady, settles a microtask later, and re-runs — an infinite
    // allocation loop that OOMs the process. Owner ids ARE stable across
    // those reruns (the hydration id contract), so the render context keeps
    // a by-slot flight record. A re-created node at a settled slot adopts
    // synchronously with exactly the sync-resolved semantics above; at a
    // still-pending slot it joins the existing flight — sharing the ONE
    // serialized deferred — instead of serializing a fresh one per pass
    // (a superseded pass's deferred would otherwise dangle in the stream
    // and hold the response open forever). Post-settle re-asks don't exist
    // for async thenable slots on the server (epoch recomputes are
    // sync-memo-only), so a recorded answer is final for the render.
    const slot: SlotRecord | undefined = id && ctx ? (ctx as any)[SLOTS]?.[id] : undefined;
    if (slot && slot.s) {
      // The just-created flight is abandoned — its answer is already known.
      // Observe its rejection so a rejecting duplicate doesn't surface as an
      // unhandled rejection (fatal under --unhandled-rejections=strict).
      (result as any).then(undefined, () => {});
      if (slot.s === 1) {
        comp.value = slot.v;
        comp.error = undefined;
        comp.errored = false;
      } else {
        comp.error = slot.v;
        comp.errored = true;
      }
      return;
    }
    const recordSlot = (s: 0 | 1 | 2, v: any, d?: DeferredPromise<any>) => {
      if (!id || !ctx) return;
      const store = ((ctx as any)[SLOTS] ||= Object.create(null));
      const prev: SlotRecord | undefined = store[id];
      if (prev) {
        prev.s = s;
        prev.v = v;
      } else store[id] = { s, v, d };
    };
    const deferred: DeferredPromise<T> = slot ? slot.d! : createDeferredPromise<T>();
    const serializes = !!(ctx?.async && ctx.serialize && id && !noHydrate);
    if (!slot) {
      recordSlot(0, undefined, deferred);
      if (serializes) ctx.serialize(id, deferred.promise, deferStream);
    }
    // Flatten one async level, mirroring the client core's handleAsync: a
    // thenable that RESOLVES to an AsyncIterable — the shape an async stub
    // returning a stream produces — is consumed as the stream itself, with
    // the SAME semantics the direct iterable branch below gives: first yield
    // settles the read (and locks the HTML-visible value), later yields
    // belong to the client through the serialized channel, hybrid takes the
    // first value and closes, and a frame render's binding ledger gets the
    // commit pump. The already-serialized `deferred.promise` stays the
    // channel: it resolves at first yield with a tapped stream (replay
    // first, then delegate), which client hydration adopts as a promise and
    // the client core flattens again.
    const flattenResolvedIterable = (source: AsyncIterable<T>) => {
      // Effective mode for the stream: declared hybrid, or a branded live
      // source under (default or declared) server mode. "server" has no
      // meaning for a standing answer — streaming it would hold the
      // document open forever — so the brand selects hybrid wherever the
      // server is the consumer, EXCEPT a server-owned frame render (the
      // ctx.commit pump below), where staying connected is the stream
      // face working as intended. Declared "client" never reaches here
      // (the compute doesn't run on the server).
      const hybrid =
        ssrSource === "hybrid" ||
        (!!(source as any)[LIVE_SOURCE] &&
          !(!serializes && ctx?.commit && inServerComponentScope()));
      // In-flight stream stamp: a re-created node handed the SAME promise
      // must JOIN this consumption (`s === 3` above), never re-consume.
      (result as any).s = 3;
      (result as any).d = deferred;
      const iter = source[Symbol.asyncIterator]();
      return iter.next().then(
        (r: IteratorResult<T>) => {
          const first = (r.done ? undefined : r.value) as T;
          // First yield is the settled answer for this render: stamp and
          // record it like a plain resolution (first-value lock — re-created
          // slots adopt V1, exactly what the document claims against).
          (result as any).s = 1;
          (result as any).v = first;
          recordSlot(1, first);
          if (!(loadingState?.served && serializes)) {
            comp.value = first;
            comp.error = undefined;
            comp.errored = false;
          }
          ctx?.commit?.();
          if (r.done) return first;
          if (hybrid) {
            // First value only; continuing the stream is the client's story
            // (re-run/reconnect on takeover).
            closeAsyncIterator(iter);
            return first;
          }
          if (serializes) {
            // Tapped stream through the promise channel: replay the first
            // result, then delegate. Later yields deliberately never advance
            // comp.value — the first-value lock, same as the direct branch.
            let tappedFirst = true;
            return {
              [Symbol.asyncIterator]: () => ({
                next() {
                  if (tappedFirst) {
                    tappedFirst = false;
                    return Promise.resolve(r);
                  }
                  return iter.next();
                },
                return(value?: any) {
                  return iter.return?.(value);
                }
              })
            } as any;
          }
          if (ctx?.commit && inServerComponentScope()) {
            // Server-owned render (noHydrate — the HTML is the data): pump
            // yields into the binding ledger under a response hold. Mirrors
            // the direct iterable branch's pump; see its comment for the
            // full story.
            const release = ctx.hold?.();
            const pump = () => {
              if (comp.disposed) {
                closeAsyncIterator(iter);
                release?.();
                return;
              }
              iter.next().then(
                (nr: IteratorResult<T>) => {
                  if (comp.disposed) {
                    closeAsyncIterator(iter);
                    release?.();
                    return;
                  }
                  if (nr.done) {
                    release?.();
                    return;
                  }
                  comp.value = nr.value;
                  ctx.commit();
                  pump();
                },
                () => release?.()
              );
            };
            deferred.promise.then(pump, () => release?.());
          }
          return first;
        },
        (error: any) => {
          // Terminal for this render: stream errors don't re-enter the
          // NotReady retry chain (the outer promise already resolved — the
          // compute's dependencies are settled; this is the stream failing).
          (result as any).s = 2;
          (result as any).v = error;
          recordSlot(2, error);
          comp.error = error;
          comp.errored = true;
          ctx?.commit?.();
          throw error;
        }
      );
    };
    settleServerAsync(
      result,
      () => (rerun ? rerun() : result),
      deferred,
      (value: T) => {
        if (typeof (value as any)?.[Symbol.asyncIterator] === "function") {
          return flattenResolvedIterable(value as unknown as AsyncIterable<T>) as unknown as T;
        }
        (result as any).s = 1;
        (result as any).v = value;
        recordSlot(1, value);
        // First-value lock for commit #0: markup rendered from the loading
        // value keeps reading it — the landing reaches the client through the
        // serialized promise, never through later-rendered HTML. Without a
        // serialization channel (frames/noHydrate) the value advances as
        // usual: no hydration claim exists there.
        if (!(loadingState?.served && serializes)) {
          comp.value = value;
          comp.error = undefined;
          comp.errored = false;
        }
        // A settle is a commit: a frame render's binding ledger (watched
        // slot args, DR-2 case 1) re-reads memos at commits. Serialized
        // settles reach the sink through their own data flush, but a
        // server-owned render (noHydrate: the HTML is the data) has no
        // flush — this hook is its only signal. No-op outside frames.
        ctx?.commit?.();
        return value;
      },
      (error: any) => {
        (result as any).s = 2;
        (result as any).v = error;
        recordSlot(2, error);
        comp.error = error;
        comp.errored = true;
        ctx?.commit?.();
      },
      () => comp.disposed
    );
    if (loadingState) {
      // Serve commit #0 instead of suspending: the boundary never trips, the
      // markup flushes with the loading value, the landing streams as data.
      loadingState.served = true;
      comp.value = loadingState.value;
    } else {
      comp.error = new NotReadyError(deferred.promise);
      comp.errored = true;
    }
    return;
  }

  const iterator = result?.[Symbol.asyncIterator];
  if (typeof iterator === "function") {
    const serializes = !!(ctx?.async && ctx.serialize && id && !noHydrate);
    // Same effective-mode rule as the thenable flatten above: the live
    // brand selects hybrid under server mode, except in a server-owned
    // frame render where the pump keeps the standing answer connected.
    const hybrid =
      ssrSource === "hybrid" ||
      (!!(result as any)[LIVE_SOURCE] && !(!serializes && ctx?.commit && inServerComponentScope()));
    if (hybrid) {
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
          // First-value lock for commit #0 (see thenable branch).
          if (!(loadingState?.served && serializes)) {
            comp.value = value;
            comp.error = undefined;
            comp.errored = false;
          }
          ctx?.commit?.();
          return value;
        },
        (error: any) => {
          comp.error = error;
          comp.errored = true;
          ctx?.commit?.();
        },
        () => comp.disposed
      );
      if (serializes) ctx.serialize(id, deferred.promise, deferStream);
      if (loadingState) {
        loadingState.served = true;
        comp.value = loadingState.value;
      } else {
        comp.error = new NotReadyError(deferred.promise);
        comp.errored = true;
      }
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
          // First-value lock for commit #0: with a loading value on a
          // serialized stream, HTML stays at commit #0 and the first yield
          // (like every later one) is the client's to apply.
          if (resolved && !resolved.done && !(loadingState?.served && serializes)) {
            comp.value = resolved.value;
          }
          if (!(loadingState?.served && serializes)) {
            comp.error = undefined;
            comp.errored = false;
          }
          ctx?.commit?.();
          return undefined;
        },
        (error: any) => {
          comp.error = error;
          comp.errored = true;
          ctx?.commit?.();
        },
        () => comp.disposed
      );

      if (serializes) {
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
              // Deliberately does NOT advance comp.value: the first-value
              // lock. Document markup rendered from V1 must keep reading V1
              // (a Loading retry re-rendering mid-stream would otherwise
              // bake V2 into HTML the client claims against V1) — later
              // yields are the CLIENT's to apply, through the serialized
              // stream. Within-response liveness for watched slot args is
              // the frame render's story (the ctx.commit pump below), where
              // no hydration claim exists.
              return iter.next().then((r: IteratorResult<T>) => r);
            },
            return(value?: any) {
              return iter.return?.(value);
            }
          })
        };
        ctx.serialize(id, tapped, deferStream);
      } else if (ctx?.commit && inServerComponentScope()) {
        // Server-owned render (noHydrate — the HTML is the data): nothing
        // serializes this iterable, so nothing pumps it past the first
        // value. When a binding ledger is listening (ctx.commit — a frame
        // render with watched slot args or live holes), keep pulling: each
        // yield advances the memo's value and commits, so bindings reading
        // this memo stay live. Scope-gated: on the document face ctx.commit
        // is armed render-wide, but an iterable memo in app-level
        // NoHydration content has no live holes reading it — pumping would
        // hold the response for nothing, so it keeps the first-value
        // latch. The pump HOLDS the response window
        // (ctx.hold): a server-consumed iterable is a bounded async trace —
        // its later yields ARE response content (hole re-emissions), so the
        // response must not complete under it. Completion (or error, or
        // disposal) releases the hold and latches the last yielded value.
        // Without a listener the iterator stays pull-paced (no consumer, no
        // pump), same as before.
        const release = ctx.hold?.();
        const pump = () => {
          if (comp.disposed) {
            closeAsyncIterator(iter);
            release?.();
            return;
          }
          iter.next().then(
            (r: IteratorResult<T>) => {
              if (comp.disposed) {
                closeAsyncIterator(iter);
                release?.();
                return;
              }
              if (r.done) {
                release?.();
                return;
              }
              comp.value = r.value;
              ctx.commit();
              pump();
            },
            () => release?.()
          );
        };
        deferred.promise.then(pump, () => release?.());
      }
      if (loadingState) {
        loadingState.served = true;
        comp.value = loadingState.value;
      } else {
        comp.error = new NotReadyError(deferred.promise);
        comp.errored = true;
      }
    }
    return;
  }

  // Synchronous value — never serialized, even under explicit ssrSource:
  // "server" (which is just the default spelled out). The code itself is the
  // value transport for sync computes: the client re-runs them on hydrated
  // inputs, and the purity contract they already live under makes that
  // converge. Serialization is the async mechanism only.
  //
  // ONE exception: a loading-value memo whose placeholder already flushed
  // (an unready sync dependency served commit #0, then the retry landed
  // synchronously). Markup rendered from commit #0 is already on the wire,
  // so the sync landing must ship as data — the client can't re-derive its
  // way out of DOM that was claimed against the placeholder — and the
  // HTML-visible value stays locked at commit #0.
  if (loadingState?.served) {
    if (ctx?.async && ctx.serialize && id && !noHydrate)
      ctx.serialize(id, Promise.resolve(result), deferStream);
    return;
  }
  comp.value = result;
  comp.sync = true;
  comp.epoch = ctx?.commitEpoch?.();
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
        // A client hole is FINAL: blocking the stream on it would hold the
        // response forever. Rethrow so the surrounding render (a Loading
        // discovery pass — the read throws loudly anywhere else) escalates
        // the suspension to the boundary, which hands off to the client.
        if (source === CLIENT_HOLE) throw err;
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
              // A retry that lands on a client hole can never settle — there
              // is no render on the stack to escalate to, so swallow: the
              // effect simply never fires server-side (the client runs it
              // after hydration), instead of blocking the stream forever.
              if (next !== CLIENT_HOLE) ctx.block(next.then(retry, () => {}));
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

/**
 * @deprecated Do not use in new code: `createEffect(compute, effect)` for
 * reactive side effects, `onSettled` for one-time post-render DOM work.
 * Retained only to ease 1.x migration — see the JSDoc in `@solidjs/signals`.
 */
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
// Commit #0 (loadingValue): never undefined, `prev` is always T — see
// createSignal/createMemo (bare "client" is the structural form there too).
export function createOptimistic<T>(
  fn: ComputeFunction<NoInfer<T>, T>,
  options: ServerSignalOptions<T> & { loadingValue: T }
): Signal<T>;
export function createOptimistic<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerSignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  first?: T | ComputeFunction<any, any>,
  second?: SignalOptions<any>
): Signal<T | undefined> {
  // Server optimistic writes are NO-OPS. On the client an optimistic write
  // is a mask that reverts when its transition settles; server output
  // represents settled state, so the write's settled value is by definition
  // the authoritative one already held. Landing the write instead (the old
  // aliasing) would serialize the optimistic mask as authoritative state.
  // The updater is not invoked at all — nothing could observe its result.
  // (Broader direction, recorded: server writes may eventually throw under
  // a dev-mode server build; that waits on having one.)
  const [read] = (createSignal as Function)(first, second) as Signal<T | undefined>;
  return [
    read,
    (() => {
      warnServerWrite("optimistic");
      return untrack(read);
    }) as Setter<T | undefined>
  ];
}

// === Store (plain objects, no proxy) ===

function setProperty(state: any, property: PropertyKey, value: any) {
  if (state[property] === value) return;
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
}

export function createStore<T extends object = {}>(
  initialValue: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ServerProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  first: T | Store<T> | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: T | Store<T>,
  third?: ServerProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  if (typeof first === "function") {
    // Forward options: dropping them made ssrSource inert for derived stores —
    // "client" sources ran on the server (#2972) and "server" ones lost their
    // deferStream/serialization hints (#2971).
    // The impl signature stays loose; the public overload above enforces the
    // client/seedLoadingValue pairing, and createProjection re-checks at
    // runtime.
    const store = createProjection(first as any, second as Partial<T>, third as any);
    return [store as Store<T>, storeSetter(store as T)];
  }
  const state = first as T;
  return [state as Store<T>, storeSetter(state)];
}

/**
 * Parity with the client's `storeSetterNext` as a plain data operation: run
 * the function against the state (draft mutations are literal mutations
 * here), and adopt a returned wrappable replacement into the same root
 * (#3064). No reactivity is implied — server-side writes update data for
 * subsequent reads and serialization only; nothing re-renders.
 */
function storeSetter<T extends object>(state: T): StoreSetter<T> {
  return ((fn: (state: T) => void | T) => {
    warnServerWrite("store");
    const result = fn(state);
    if (result !== undefined && (result as unknown) !== state && isWrappable(result)) {
      replaceState(state, result as T);
    }
  }) as StoreSetter<T>;
}

export function createOptimisticStore<T extends object = {}>(
  initialValue: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ServerProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | Store<T> | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: T | Store<T>,
  third?: ServerProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  // Same no-op rationale as createOptimistic above: optimistic writes are
  // masks that revert at settle, and server output is settled state. The
  // setter never invokes its function — a draft mutation here would be a
  // literal (permanent) mutation, the opposite of optimistic.
  const [store] = (createStore as Function)(first, second, third) as [Store<T>, StoreSetter<T>];
  return [store, (() => warnServerWrite("optimistic")) as StoreSetter<T>];
}

/**
 * Wraps a store in a Proxy that throws NotReadyError on property and
 * structural reads while the async data is pending. Once markReady() is
 * called, reads pass through to the underlying state.
 */
function createPendingProxy<T extends object>(
  state: T,
  source: Promise<any>
): [proxy: Store<T>, markReady: (frozenState?: T) => void, markError: (error: any) => void] {
  let status: 0 | 1 | 2 = 0;
  let error: any;
  let readTarget: T = state;
  const gate = () => {
    if (status > 1) throw error;
    if (status) return;
    // Bare client store: same loud-outside-a-boundary rule as the memo
    // read path (see clientHoleRead).
    if (source === CLIENT_HOLE) clientHoleRead();
    throw new NotReadyError(source);
  };
  const proxy = new Proxy(state, {
    get(obj, key, receiver) {
      gate();
      return Reflect.get(readTarget, key);
    },
    has(obj, key) {
      gate();
      return Reflect.has(obj, key);
    },
    ownKeys(obj) {
      gate();
      return Reflect.ownKeys(obj);
    },
    getOwnPropertyDescriptor(obj, key) {
      gate();
      return Reflect.getOwnPropertyDescriptor(obj, key);
    }
  });
  return [
    proxy as Store<T>,
    (frozen?: T) => {
      if (frozen) readTarget = frozen;
      status = 1;
    },
    (reason: any) => {
      error = reason;
      status = 2;
    }
  ];
}

// === Projection traces (the container tier at the slot border) ===
//
// A projection crossing a serialization boundary ships as its TRACE: an
// async iterable whose first yield is a full state snapshot and whose later
// yields are PatchOp batches — the same continuation protocol hydration
// resume has always used. The registry maps each async projection's
// returned proxy to a subscribe() factory; the serialization layer (the
// projection seroval plugin) tests values against it, which is what lets a
// projection serialize correctly from ANY depth of an argument graph
// instead of crashing seroval's property walk on a pending proxy's reads.
//
// Sync projections never register: with no async source nothing can re-run
// them inside a response (server render is pure — change enters only
// through async), so they are constants and serialize as the plain data
// they hold.
export interface ProjectionTrace {
  /** An independent consumer: snapshot at subscribe, then every batch after. */
  subscribe(): AsyncIterable<any>;
  /** Whether the projection's root is an array — the consumer's seed shape. */
  array: boolean;
}

const projectionTraces = new WeakMap<object, ProjectionTrace>();

/**
 * The trace for a projection proxy, or `undefined` for anything that isn't
 * an async projection (including plain stores and settled sync projections
 * — both are constants within a response and serialize as plain data).
 *
 * @internal — consumed by the serialization layer (@solidjs/web).
 */
export function getProjectionTrace(value: unknown): ProjectionTrace | undefined {
  return typeof value === "object" && value !== null ? projectionTraces.get(value) : undefined;
}

// A detached copy of projection state — the root container alone for a
// shallow store (its leaves are raw references by contract, #3498), the whole
// tree otherwise. Twin of the client's `cloneState` (store/next/projection.ts).
function cloneState<T extends object>(v: T, shallow?: boolean): T {
  return shallow ? (Array.isArray(v) ? (v.slice() as T) : { ...v }) : JSON.parse(JSON.stringify(v));
}

// Settles-once projections (promise-driven retry, thenable derives, hybrid
// iterables): the trace is one snapshot after settlement, then done — the
// border analogue of "reads pass through once markReady runs". A rejection
// propagates through the iterable so the consumer's read errors rather
// than hanging.
function registerSettledTrace(
  pending: object,
  ready: Promise<any>,
  state: object,
  shallow?: boolean
) {
  projectionTraces.set(pending, {
    array: Array.isArray(state),
    subscribe: async function* () {
      await ready;
      yield cloneState(state, shallow);
    }
  });
}

/**
 * A replacement value returned/yielded by a projection derive is an
 * authoritative snapshot, not a merge patch (client parity: the projection
 * commit reconciles with replace semantics): keys absent from the
 * replacement are deleted rather than retained from the seed or a previous
 * yield (#2948). When `target` is the patch-recording draft, the deletes
 * and sets both join the emitted batch.
 */
function replaceState<T extends object>(target: T, next: T): void {
  if (Array.isArray(target) && Array.isArray(next)) {
    // `delete` on an index leaves a hole without shrinking `length`, so
    // arrays need explicit truncation rather than the key-diff below.
    for (let i = 0; i < next.length; i++) target[i] = next[i];
    target.length = next.length;
    return;
  }
  for (const key of Object.keys(target)) {
    if (!(key in (next as object))) delete (target as any)[key];
  }
  Object.assign(target, next);
}

export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ServerProjectionOptions
): Refreshable<Store<T>>;
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ServerProjectionOptions
): Store<T> {
  const ctx = sharedConfig.context;
  const owner = createOwner();
  // The projection's own owner, read at creation — never a swapped hole scope.
  const id = ownerId(owner);
  // Slot memory (#3068), the projection flavor of the memo slots above
  // (#3003): retry loops converge by re-running creation scopes, and an
  // async projection can NEVER be ready at creation-scope read time (a
  // generator's first yield / a promise's resolution is at least a microtask
  // away). Without memory, a body-time property read of the pending proxy
  // threw NotReady, the retry re-ran the scope, and this function allocated
  // a fresh generator + deferred + serialized promise per pass — the read
  // could never succeed and the flush loop pinned the process (0 bytes,
  // 100% CPU, unbounded blockingPromises growth). Owner ids are stable
  // across re-runs (ssrScope zeroes the hole's child counter per attempt —
  // the hydration id contract), so a re-created projection at a known slot
  // returns the SAME proxy: pending passes join the in-flight instance —
  // one generator, one trace, one serialized channel — and post-settle
  // passes read through it synchronously. Only async shapes record (the
  // four pending-proxy returns below); sync derives re-run like any other
  // sync code in a retried scope.
  const slotId = ctx && id;
  const slots: Record<string, Store<T>> | undefined = slotId
    ? ((ctx as any)[PROJECTION_SLOTS] ||= Object.create(null))
    : undefined;
  if (slots && slots[slotId!]) return slots[slotId!];
  const recordSlot = (proxy: Store<T>) => {
    if (slots) slots[slotId!] = proxy;
    return proxy;
  };
  const [state] = createStore(seed as NoFn<T>);

  if (options?.ssrSource === "client") {
    // seedLoadingValue = declared commit #0: the seed renders. Bare = the
    // structural form: reads suspend as a FINAL hole (see CLIENT_HOLE) and
    // the nearest <Loading> boundary hands the position to the client.
    if (options.seedLoadingValue === true) return state;
    return createPendingProxy(state, CLIENT_HOLE)[0];
  }

  let disposed = false;
  // On the creation context, not `owner` — retry resets `owner` (#2900).
  onCleanup(() => {
    disposed = true;
  });

  const ssrSource = options?.ssrSource;
  const useProxy = ssrSource !== "hybrid";
  // Projections have no server-component continuation pump: a standing live
  // answer always hands off after V1, including no-hydrate/frame consumers.
  const usesHybrid = (source: AsyncIterable<unknown>) =>
    ssrSource === "hybrid" || !!(source as any)[LIVE_SOURCE];
  const patches: PatchOp[] = [];
  const draft = useProxy
    ? createDeepProxy(state as any, patches, [], options?.shallow)
    : (state as any as T);
  const takeFirst = (source: AsyncIterable<void | T>) =>
    Promise.resolve().then(() => {
      const iter = source[Symbol.asyncIterator]();
      return Promise.resolve(iter.next()).then((first: IteratorResult<void | T>) => {
        if (first.done) return undefined;
        closeAsyncIterator(iter);
        return first.value;
      });
    });
  const normalizeAsync = (value: any) =>
    Promise.resolve(value).then(value =>
      // A bounded Promise→AsyncIterable needs the projection patch-trace
      // protocol; only one-shot hybrid/live sources normalize to a value here.
      typeof value?.[Symbol.asyncIterator] === "function" && usesHybrid(value)
        ? takeFirst(value)
        : value
    );
  // seedLoadingValue = commit #0: reads never throw, they serve a frozen copy
  // of the seed for the whole response (first-value lock — `state` still
  // advances underneath for patch/serialization correctness, the landing is
  // the client's to apply). Applied by immediately marking each pending
  // proxy ready, retargeted at the frozen seed. The copy is taken NOW, before
  // the derive runs: commit #0 is the seed alone — pre-await draft writes are
  // uncommitted work like every other mid-flight state, not part of the
  // declared first paint (#2988 ruling; the client's shadow draft enforces
  // the same line, and hydration claims against the plain seed).
  const seedLoading = !!options?.seedLoadingValue;
  const frozenSeed = seedLoading ? cloneState(state, options?.shallow) : undefined;

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
    const [pending, markReady, markError] = createPendingProxy(state, deferred.promise);
    if (seedLoading) markReady(frozenSeed);
    settleServerAsync<void | T, T>(
      Promise.reject(error),
      () => normalizeAsync(runProjection()),
      deferred,
      (value: void | T) => {
        if (value !== undefined && value !== state && value !== draft) {
          replaceState(state, value as T);
        }
        markReady();
        return state as T;
      },
      markError,
      () => disposed
    );
    registerSettledTrace(pending, deferred.promise, state, options?.shallow);
    if (ctx?.async && !getContext(NoHydrateContext) && id)
      ctx.serialize(id, deferred.promise, options?.deferStream);
    return recordSlot(pending);
  }

  // Async iterable (generator)
  const iteratorFn = (result as any)?.[Symbol.asyncIterator];
  if (typeof iteratorFn === "function") {
    if (usesHybrid(result as AsyncIterable<void | T>)) {
      let currentResult = result;
      const deferred = createDeferredPromise<T>();
      const [pending, markReady, markError] = createPendingProxy(state, deferred.promise);
      if (seedLoading) markReady(frozenSeed);
      const runFirst = () => {
        const source = currentResult ?? runProjection();
        currentResult = undefined;
        return takeFirst(source as AsyncIterable<void | T>);
      };
      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        (value: void | T) => {
          if (value !== undefined && value !== state && value !== draft) {
            replaceState(state, value as T);
          }
          markReady();
          return state as T;
        },
        markError,
        () => disposed
      );
      registerSettledTrace(pending, deferred.promise, state, options?.shallow);
      if (ctx?.async && !getContext(NoHydrateContext) && id)
        ctx.serialize(id, deferred.promise, options?.deferStream);
      return recordSlot(pending);
    } else {
      // Full streaming: eagerly start first iteration. Tapped wrapper replays
      // first value as full state snapshot, then yields patch batches.
      let currentResult = result;
      let iter: AsyncIterator<void | T>;
      let firstResult: IteratorResult<void | T> | undefined;
      const deferred = createDeferredPromise<void>();
      const [pending, markReady, markError] = createPendingProxy(state, deferred.promise);
      if (seedLoading) markReady(frozenSeed);
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
            replaceState(state, resolved.value as T);
          }
          // Lock SSR-visible state at V1: subsequent generator mutations update
          // `state` (for draft/patch correctness) but reads go through the frozen
          // copy. With seedLoadingValue the lock already sits at commit #0 — the
          // seed — so V1 must NOT retarget it (undefined keeps the read target).
          markReady(seedLoading ? undefined : cloneState(state, options?.shallow));
          return undefined;
        },
        markError,
        () => disposed
      );

      // The trace: snapshot-then-patch-batches, MULTI-consumer. The source
      // iterator is single-pull, but two independent consumers legitimately
      // want the same trace — the hydration resume channel (below) and any
      // slot-border crossing (a projection passed to a server component's
      // slot serializes as its trace; see getProjectionTrace). So one shared
      // pump drives `iter`, appending each drained batch to a log, and every
      // subscriber replays the log from its own cursor. A subscriber's first
      // yield is a snapshot of `state` captured at a STABLE point (no next()
      // in flight — an async generator can mutate the draft across interior
      // awaits, and a snapshot taken mid-execution would double-apply the
      // undrained writes when their batch lands, duplicating array inserts),
      // with its cursor at the log's end: state already contains every
      // logged batch, so replay starts strictly after the snapshot.
      const log: PatchOp[][] = [];
      let logDone = false;
      let logError: any;
      let pumping: Promise<void> | null = null;
      let consumers = 0;
      const pump = () =>
        (pumping ??= iter.next().then(
          (r: IteratorResult<void | T>) => {
            pumping = null;
            if (disposed || r.done) {
              logDone = true;
              return;
            }
            // Apply the replacement through the patch-recording draft BEFORE
            // draining: its sets/deletes must ride in THIS batch, not sit
            // unsent behind an already-emitted empty one (#2948).
            if (r.value !== undefined && r.value !== draft) {
              replaceState(draft, r.value as T);
            }
            log.push(patches.splice(0));
          },
          (error: any) => {
            pumping = null;
            logDone = true;
            logError = error;
          }
        ));
      const subscribe = async function* (): AsyncGenerator<T | PatchOp[]> {
        await deferred.promise;
        if (firstResult?.done) return;
        while (pumping) await pumping;
        // Stable point (sync block): no in-flight next(), so `patches` is
        // drained and `state` equals the log applied in full.
        let cursor = log.length;
        consumers++;
        try {
          yield cloneState(state, options?.shallow);
          while (true) {
            if (cursor < log.length) {
              yield log[cursor++];
              continue;
            }
            if (logDone) {
              if (logError) throw logError;
              return;
            }
            await pump();
          }
        } finally {
          // A consumer cancelling early (response teardown) releases its
          // hold; the LAST cancellation closes the source so generator
          // finally-blocks run. Traces are response-scoped, so nobody can
          // subscribe meaningfully after every consumer is gone.
          if (--consumers === 0 && !logDone) closeAsyncIterator(iter);
        }
      };
      projectionTraces.set(pending, { subscribe, array: Array.isArray(state) });

      if (ctx?.async && !getContext(NoHydrateContext) && id) {
        ctx.serialize(id, subscribe(), options?.deferStream);
      }
      return recordSlot(pending);
    }
  }

  if (isThenable<T>(result)) {
    const deferred = createDeferredPromise<T>();
    const [pending, markReady, markError] = createPendingProxy(state, deferred.promise);
    if (seedLoading) markReady(frozenSeed);
    settleServerAsync(
      normalizeAsync(result),
      () => normalizeAsync(runProjection()),
      deferred,
      (value: void | T) => {
        if (value !== undefined && value !== state && value !== draft) {
          replaceState(state, value as T);
        }
        markReady();
        return state as T;
      },
      markError,
      () => disposed
    );
    registerSettledTrace(pending, deferred.promise, state, options?.shallow);
    if (ctx?.async && !getContext(NoHydrateContext) && id)
      ctx.serialize(id, deferred.promise, options?.deferStream);
    return recordSlot(pending);
  }

  // Synchronous: fn either mutated state directly (void) or returned a new value
  if (result !== undefined && result !== state && result !== draft) {
    replaceState(state, result as T);
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
  // Slot layout mirrors the client exactly: the row id space is a real owner
  // at child slot 0 (the client's internal row owner) and the memo sits at
  // slot 1 (the client's computed node). The `list` getter is evaluated
  // inside the memo — where the client evaluates it — because getters are
  // allocation-capable: a compiled conditional prop creates a condition memo
  // per evaluation (#2976). Evaluating it in the row id space would both
  // misplace that allocation and shift the row base by one.
  const rowOwner = createOwner() as unknown as SSROwner;
  const read = createMemo(
    () => {
      const items = list();
      const s: U[] = [];
      // Reset per pass so retries re-synthesize row/fallback ids from 0,
      // like the client's fresh row owners on its first successful pass.
      rowOwner._childCount = 0;
      if (items && items.length) {
        runWithOwner(rowOwner as unknown as Owner, () => {
          // Own owner, not a swapped hole scope: a row's holes swap it only
          // inside `mapFn`, and restore before the next iteration.
          const origId = ownerId(rowOwner);
          try {
            for (let i = 0, len = items.length; i < len; i++) {
              if (origId !== undefined) {
                rowOwner.id = formatChildId(origId, i);
              }
              rowOwner._childCount = 0;
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
            rowOwner.id = origId;
            rowOwner._childCount = items.length;
          }
        });
      } else if (options.fallback) {
        const fo = runWithOwner(rowOwner as unknown as Owner, () => createOwner());
        s.push(runWithOwner(fo, () => options.fallback!()) as U);
      }
      return s;
    },
    { sync: true }
  );
  return read;
}

export function repeat<T>(
  count: Accessor<number>,
  mapFn: (i: number) => T,
  options: { fallback?: Accessor<any>; from?: Accessor<number | undefined> } = {}
): () => T[] {
  // See mapArray — same row-owner-at-slot-0 / memo-at-slot-1 layout so the
  // `count`/`from` getters evaluate where the client's computed node
  // evaluates them (#2976).
  const rowOwner = createOwner() as unknown as SSROwner;
  const read = createMemo(
    () => {
      const len = count();
      const offset = options.from?.() || 0;
      rowOwner._childCount = 0;
      if (!len) {
        if (!options.fallback) return [];
        const fo = runWithOwner(rowOwner as unknown as Owner, () => createOwner());
        return [runWithOwner(fo, () => options.fallback!()) as T];
      }
      const out: T[] = new Array(len);
      runWithOwner(rowOwner as unknown as Owner, () => {
        const origId = ownerId(rowOwner);
        try {
          for (let i = 0; i < len; i++) {
            if (origId !== undefined) {
              rowOwner.id = formatChildId(origId, i);
            }
            rowOwner._childCount = 0;
            out[i] = mapFn(i + offset);
          }
        } finally {
          rowOwner.id = origId;
          rowOwner._childCount = len;
        }
      });
      return out;
    },
    { sync: true }
  );
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
   *
   * `onReveal` (a Loading's, observe tier): called when the group issues the
   * swap for `key` — its `revealFragments` — so the boundary record can say
   * how long the finished content was held. Synchronous from `onResolved`
   * when the order lets the child reveal live; later otherwise.
   */
  register(
    key: string,
    options?: { onActivate?: () => void; onReveal?: () => void }
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
  const prevLoadingPhase = context?._loadingPhase;
  if (context) {
    sharedConfig.context = context;
    if (boundaryId !== undefined) {
      context._currentBoundaryId = boundaryId;
      // Marks a Loading discovery pass — the only render phase with a
      // retryable NotReady catch. Only this call sets it (regions and lazy
      // module attribution assign `_currentBoundaryId` directly, without any
      // catch), so consumers that need to escalate a NotReady into a
      // suspension (the head registry's readiness probe) gate on this flag
      // via `sharedConfig.context` rather than on `_currentBoundaryId`.
      // Unlike `_currentBoundaryId` (an accessor on the base context over a
      // shared tracking slot), this is an own property on the boundary's
      // buffered context, so it scopes to this subtree automatically.
      context._loadingPhase = true;
    }
  }
  try {
    return runWithOwner(owner, () => {
      const parentHandler = getContext(ErrorContext);
      setContext(ErrorContext, err => onError(err, parentHandler));
      return render();
    }) as T;
  } finally {
    if (context) {
      if (boundaryId !== undefined) {
        context._currentBoundaryId = prevBoundary;
        context._loadingPhase = prevLoadingPhase;
      }
      sharedConfig.context = prevCtx;
    }
  }
}

export { NoHydrateContext };

// --- What a render failure looks like from the client ------------------------
//
// A plain thrown value reaching the client verbatim ships its `message`,
// `cause` and every own property — a driver error's failing query,
// connection string, bound params — to anyone who can trigger the throw.
// The server-function wire has sanitized that since #3113/#3116
// (`sanitizeServerError`); the SSR roads did not (#3468): an <Errored>
// serializing the error it caught so the client hydrates the same fallback,
// a rejected async source serialized into the stream, a <Loading> fragment
// rejecting its `_fr` promise, a frame stream's error chunk. A `"use server"`
// function called in-process during SSR never touches dispatch, so the
// production page load leaked exactly what its RPC wire withholds.
//
// One policy for every road, applied where the value is about to be
// rendered or serialized FOR the client — never to what the server keeps:
// the observe tier's findings and records carry the original beside it.
//
//  - The dev/prod line is the build variant, `IS_DEV` — `server.dev.js`
//    behind the `development` condition keeps fidelity; the prod and observe
//    artifacts sanitize — the same gate every dev check in this entry uses,
//    so a harness that runs the entry from source is uniformly the dev tier
//    (the server-function wire's `sanitizeServerError` reads its literal
//    strictly instead, because that entry's raw source is a plausible
//    runtime; this one's is not, and the artifact specs pin the replace).
//  - A value branded with `markSafeError` (`Symbol.for("solid.SafeError")`,
//    registered so this needs nothing from `@solidjs/web`) is intentional
//    client-facing content and passes through.
//  - One verdict per original: the same error reaches this through several
//    roads (the boundary's catch, the channel it rejected, a Loading re-pull
//    recurring the throw), and every road hands the client the same value.
//
// THE SERVER ERROR HOOK (sentry-integration-plan C6, #3468 part 3). The
// prod tier has no `OBSERVE`, so everything the runtime HANDLES — a
// fallback rendered, a fragment rejected and re-rendered by the client, a
// server-function throw sanitized — was invisible to a production error
// monitor; only the failure that fails the request reached `onError`. The
// hook is the prod-tier seam for both reporting and mapping: called ONCE
// per error object, at first sight, with where the failure was met; its
// return, when not `undefined`, is the wire value — the author's intent,
// like a `wrapInvocation` mapping, not second-guessed. Two tiers, as
// `wrapInvocation` has: ambient (`configureServerErrors` in `@solidjs/web`,
// parked on `globalThis` under a registered symbol so a bundled build and an
// instrumented `--import`ed copy share it) and per request
// (`renderToStream(code, { onError })`, set on the SSR context as
// `errorPolicy`; the server-function handler's option is passed explicitly).
// Prod-tier code throughout: no `OBSERVE`, no finding text.
const SAFE_ERROR = Symbol.for("solid.SafeError");
const SERVER_ERRORS = Symbol.for("solid-js/server/errors");
const REQUEST_CONTEXT = Symbol.for("solid.RequestContext");
const GENERIC_SERVER_ERROR_MESSAGE = "Internal Server Error";

/** Where a failure was met, as the hook hears it (the `event` is added at the call). */
export interface ServerErrorSite {
  kind: "render" | "server-function";
  handling: "fallback" | "client" | "failed" | "serialize" | "thrown" | "channel";
  boundary?: string;
  /**
   * Where the error was THROWN: component labels root-first up the owner
   * chain it escaped (the observe and dev builds label owners). The
   * boundary's chain when the thrower is unknown.
   */
  ownerPath?: string[];
  /** Where it was MET: the labels up the chain of the boundary named by `boundary`. */
  boundaryPath?: string[];
  functionId?: string;
  direct?: boolean;
  /** The request event, when the caller has it in hand; else read from the request scope. */
  event?: unknown;
}
export type ServerErrorHook = (error: unknown, context: ServerErrorSite) => unknown | void;

/** The verdict on one error object: whether the hook has heard of it, and the wire value once decided. */
interface Verdict {
  reported: boolean;
  decided: boolean;
  wire?: unknown;
  recorded: boolean;
}
const verdicts = new WeakMap<object, Verdict>();
const isObject = (value: unknown): value is object =>
  value !== null && (typeof value === "object" || typeof value === "function");
const verdictOf = (value: unknown): Verdict | undefined => {
  if (!isObject(value)) return undefined;
  let verdict = verdicts.get(value);
  if (verdict === undefined)
    verdicts.set(value, (verdict = { reported: false, decided: false, recorded: false }));
  return verdict;
};

/** The ambient hook (`configureServerErrors`), read off the registered slot. */
function ambientServerErrorHook(): ServerErrorHook | undefined {
  const slot = (globalThis as { [SERVER_ERRORS]?: { hook?: ServerErrorHook } })[SERVER_ERRORS];
  return slot === undefined ? undefined : slot.hook;
}
/** The request in scope, read the way `getRequestEvent()` reads it — the registered request store. */
function currentRequestEvent(): unknown {
  const store = (globalThis as { [REQUEST_CONTEXT]?: { getStore?(): unknown } })[REQUEST_CONTEXT];
  return store !== undefined && typeof store.getStore === "function" ? store.getStore() : undefined;
}

/**
 * Tells the server error hook about `value` — once per error object, at
 * first sight — and returns `{ mapped: true, value }` when the hook (now or
 * on an earlier sight) gave a wire value, `{ mapped: false }` otherwise.
 * `hook` is a per-request override (the server-function handler's option);
 * without one the SSR context's `errorPolicy` (`renderToStream`'s option)
 * answers, then the ambient registration. A throwing hook is reported on the
 * console and treated as having said nothing. `ownerPath` is filled from
 * `subject` when the site did not name it.
 * @internal
 */
export function reportServerError(
  value: unknown,
  site: ServerErrorSite,
  subject?: DiagnosticSubject | null,
  hook?: ServerErrorHook
): { mapped: boolean; value?: unknown } {
  const verdict = verdictOf(value);
  if (verdict !== undefined && verdict.reported) {
    return verdict.decided ? { mapped: true, value: verdict.wire } : { mapped: false };
  }
  if (verdict !== undefined) verdict.reported = true;
  const ctx = sharedConfig.context as { errorPolicy?: ServerErrorHook } | undefined;
  const target = hook ?? (ctx && ctx.errorPolicy) ?? ambientServerErrorHook();
  if (target === undefined) return { mapped: false };
  const context: ServerErrorSite = { ...site };
  const boundary = subject ? ownerLabels(subject) : undefined;
  if (context.ownerPath === undefined) {
    const thrower = throwerOf(value);
    const path = (thrower !== undefined ? ownerLabels(thrower) : undefined) ?? boundary;
    if (path !== undefined) context.ownerPath = path;
  }
  if (context.boundaryPath === undefined && boundary !== undefined) context.boundaryPath = boundary;
  if (context.event === undefined) {
    const event = currentRequestEvent();
    if (event !== undefined) context.event = event;
  }
  let mapped: unknown;
  try {
    mapped = target(value, context);
  } catch (hookError) {
    console.error(hookError);
    return { mapped: false };
  }
  // A request that fails has no wire: the hook's return is ignored there,
  // and does not bind the roads a later sight of the same error may take.
  if (mapped === undefined || site.handling === "failed") return { mapped: false };
  if (verdict !== undefined) {
    verdict.decided = true;
    verdict.wire = mapped;
  }
  return { mapped: true, value: mapped };
}

/** Component labels up an owner chain, root first — the server owner's own fields. */
function ownerLabels(subject: DiagnosticSubject): string[] | undefined {
  if (!("_parent" in subject)) return undefined;
  return ownerChainLabels(subject);
}

/**
 * Root-first names of the owners enclosing `subject` — the server twin of
 * the core's `ownerPath` (`<App> › <TodoRow> › effect`). Server signals do
 * not register an owner, so a signal subject answers `undefined` here where
 * the client hops to its registering owner.
 */
export function ownerPath(subject: DiagnosticSubject | null | undefined): string[] | undefined {
  if (!subject || !("_parent" in subject)) return undefined;
  return ownerChainLabels(subject);
}

function ownerChainLabels(subject: DiagnosticSubject): string[] | undefined {
  const path: string[] = [];
  for (let owner: any = subject; owner; owner = owner._parent) {
    const name = owner._name;
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

/**
 * The value the client may see in place of `value`, a render failure about
 * to be rendered into a fallback or serialized. With a `site` this is the
 * failure's containment point: the hook hears of it first (see
 * `reportServerError`) and its mapping, if any, is the answer. Otherwise —
 * and for the roads that carry the value without meeting it (a channel's
 * rejection, a live hole's message) — the default: `value` itself in the dev
 * build or when branded safe, else one generic `Error` per original. The
 * verdict is cached on the object, so every road hands the client the same
 * value. Outside dev a replacement is recorded once as
 * `SSR_ERROR_SANITIZED` (observe/dev), the original in `data.error` —
 * advisory (`info`): the failure itself is the `SSR_RENDER_ERROR_CONTAINED`
 * finding's, and this is the record of what the wire carried instead.
 * `subject` locates it (the boundary's owner; `null` from a funnel).
 * @internal
 */
export function ssrSanitizeError(
  value: unknown,
  subject?: DiagnosticSubject | null,
  site?: ServerErrorSite
): unknown {
  const verdict = verdictOf(value);
  if (site !== undefined) {
    const report = reportServerError(value, site, subject);
    if (report.mapped) return record(value, report.value, verdict, subject);
  }
  if (verdict !== undefined && verdict.decided) return verdict.wire;
  const wire =
    IS_DEV || (isObject(value) && (value as any)[SAFE_ERROR])
      ? value
      : new Error(GENERIC_SERVER_ERROR_MESSAGE);
  if (verdict !== undefined) {
    verdict.decided = true;
    verdict.wire = wire;
  }
  return record(value, wire, verdict, subject);
}

/** The advisory record of a replacement, once per original. */
function record(
  value: unknown,
  wire: unknown,
  verdict: Verdict | undefined,
  subject: DiagnosticSubject | null | undefined
): unknown {
  if (wire === value || (verdict !== undefined && verdict.recorded)) return wire;
  if (verdict !== undefined) verdict.recorded = true;
  if (IS_OBSERVE)
    emitFinding(
      {
        code: "SSR_ERROR_SANITIZED",
        kind: "ssr",
        severity: "info",
        message: `[SSR_ERROR_SANITIZED] Render error replaced before reaching the client: ${errorText(value)}`,
        data: { error: value, wire }
      },
      subject === undefined ? getOwner() : subject
    );
  return wire;
}

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
  // The client boundary is two computeds under `owner`: one runs `fn`, the
  // next flattens its result. A zero-arg function `fn` hands back — a nested
  // boundary's accessor, the `fallback={() => ...}` thunk it returns
  // unresolved, a function child — is unwrapped inside that second computed,
  // so what it renders takes ids under `owner`'s second child. Resolving
  // inline under `owner` gave that content `owner`'s next child id instead,
  // one level up from the client's, and a server-rendered fallback hydrated
  // dead (#3414). Mirror the second computed as a virtual scope (ssrScope's
  // technique): `owner` keeps its identity — retry wraps capture the owner
  // and read this pull's error handler off it — and only its id counter is
  // rewritten for the duration of the resolve. A retry pull resumes the
  // surviving holes in the same scope, the counter continuing where the
  // discovery pass left it.
  const idOwner = owner as unknown as SSROwner;
  let resolveId: string | undefined;
  let resolveCount = 0;
  const resolveIn = <R>(run: () => R): R => {
    if (resolveId === undefined) return run();
    const prevId = ownerId(idOwner);
    const prevCount = idOwner._childCount;
    idOwner.id = resolveId;
    idOwner._childCount = resolveCount;
    try {
      return run();
    } finally {
      resolveCount = idOwner._childCount;
      idOwner.id = prevId;
      idOwner._childCount = prevCount;
    }
  };
  const resolve = () => {
    let resolved: any;
    if (pending) resolved = resolveIn(() => ctx!.ssr(pending!.t, ...pending!.h));
    else {
      const value = runWithOwner(createOwner(), fn);
      resolveId = idOwner.id != null ? nextChildIdFor(idOwner, true) : undefined;
      resolveCount = 0;
      resolved = resolveIn(() => ctx!.resolve(value));
    }
    pending = resolved?.p?.length ? resolved : undefined;
    if (pending) {
      // Propagate the FINAL classification through the aggregate: with a
      // client hole in the set, the combined promise can never settle, and
      // the outer Loading boundary must see the tag to hand off instead of
      // awaiting it (see CLIENT_HOLE).
      const all: any = Promise.all(pending.p);
      if (pending.p.some(p => (p as any).$clientHole)) all.$clientHole = true;
      throw new NotReadyError(all);
    }
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
  // The boundary's own id, read once: an error lands mid-resolve, while
  // `owner.id` is rewritten to the resolve scope's (see `resolveIn`), and the
  // client looks the record up at the boundary id.
  const boundaryId = ownerId(idOwner);
  const serializeError = (err: any) => {
    if (ctx && boundaryId && !runWithOwner(owner, () => getContext(NoHydrateContext))) {
      ctx.serialize(boundaryId, err);
    }
  };
  // The finding (observe/dev): a render error this boundary contained by
  // rendering its fallback — the response completes, the failure is real,
  // and nothing else records it (renderToStream never rejects for it and
  // `onError` never hears it). Once per boundary per failure text: the
  // enclosing Loading re-pulls this accessor on every discovery pass and the
  // same throw recurs each time.
  let reportedFailure: string | undefined;
  const reportContained = (err: any) => {
    if (!IS_OBSERVE) return;
    const text = errorText(err);
    if (reportedFailure === text) return;
    reportedFailure = text;
    emitFinding(
      {
        code: "SSR_RENDER_ERROR_CONTAINED",
        kind: "ssr",
        severity: "error",
        message: `[SSR_RENDER_ERROR_CONTAINED] Render error caught by <Errored>: ${text}`,
        data: {
          handling: "fallback",
          boundary: owner.id,
          boundaryPath: ownerLabels(owner),
          error: err
        }
      },
      // Located where it was THROWN, the boundary that met it in `data`.
      throwerOf(err) ?? owner
    );
  };
  // The finding first, with the original; then the one value the client may
  // see — rendered into the fallback AND serialized, since the fallback is
  // rendered here with the error and hydrates against the record (a
  // sanitized record under a fallback rendered from the original would
  // mismatch). See `ssrSanitizeError`.
  const handleError = (err: any) => {
    reportContained(err);
    const wire = ssrSanitizeError(err, owner, {
      kind: "render",
      handling: "fallback",
      boundary: boundaryId
    });
    serializeError(wire);
    return renderFallback(wire);
  };
  // `$lhSkip`: boundary machinery owns this position (see ssrLoadingBoundary)
  // — a live binding over the boundary's output would re-run resolve(),
  // which re-creates owners and re-enters retry plumbing per sweep.
  return Object.assign(
    () => {
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
    },
    { $lhSkip: true }
  );
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

// === Server Component Scope (context barrier) ===

/**
 * Marker entry present in every context record descended from a
 * server-component render root. Lets `useContext` explain a blocked read
 * instead of surfacing a misleading "no provider" error.
 *
 * @internal
 */
const ServerComponentContext: Context<boolean> = {
  id: Symbol("ServerComponentContext"),
  defaultValue: false
};

/**
 * Runs `fn` under a context barrier — the render root of a server
 * component.
 *
 * A server component renders standalone on every response after the first
 * (refetches, mutation regions): there is no surrounding app tree, so app
 * context can never reach it there. At t=0 it renders INLINE in the
 * document tree, where an app-level provider WOULD resolve — a silent
 * divergence where context "works" once and breaks on the next response.
 * The barrier makes t=0 behave like every later render by construction:
 * the scope owner gets a rebuilt context record carrying only the boundary
 * plumbing, so
 *
 *   - `Loading` / `Errored` / reveal-group coordination still crosses (the
 *     back-and-forth between a server component's async content and the
 *     enclosing boundaries at t=0 is intentional — `ErrorContext`,
 *     `RevealGroupContext`, and `NoHydrateContext` are copied through);
 *   - providers rendered INSIDE the server component work normally;
 *   - defaulted contexts read their default (both paths agree);
 *   - default-less contexts throw — `useContext` upgrades the miss to an
 *     error that explains the boundary.
 *
 * The owner is transparent, so hydration-id chains are untouched.
 *
 * @internal
 */
export function runInServerComponentScope<T>(fn: () => T): T {
  const owner = createOwner({ transparent: true }) as unknown as SSROwner;
  const inherited = owner._context;
  const scoped: Record<symbol | string, unknown> = {
    [ServerComponentContext.id]: true
  };
  if (inherited[ErrorContext.id] !== undefined) {
    scoped[ErrorContext.id] = inherited[ErrorContext.id];
  }
  if (inherited[RevealGroupContext.id] !== undefined) {
    scoped[RevealGroupContext.id] = inherited[RevealGroupContext.id];
  }
  if (inherited[NoHydrateContext.id] !== undefined) {
    scoped[NoHydrateContext.id] = inherited[NoHydrateContext.id];
  }
  owner._context = scoped;
  return runWithOwner(owner as unknown as Owner, fn);
}

/**
 * Whether the current owner is inside a server-component render scope.
 * The live-hole engine's arming gate on the document face: a document
 * render arms `ctx.liveHoles` once (any server component present), but
 * only holes minted INSIDE a component's barrier may mark and bind —
 * plain app content keeps its t=0 latch and its exact bytes. O(1): the
 * barrier writes `ServerComponentContext` into the scope owner's context
 * record and records inherit by spread at owner creation.
 * @internal
 */
export function inServerComponentScope(): boolean {
  const o = currentOwner;
  return !!o && o._context[ServerComponentContext.id] === true;
}

/**
 * Builds the explanatory error for a context read that missed INSIDE a
 * server-component scope, or returns `null` when the current owner isn't
 * inside one (the caller rethrows its original error). Called by
 * `useContext` only on the failure path — the success path stays a plain
 * record read.
 *
 * @internal
 */
export function serverComponentContextError(context: Context<any>): Error | null {
  const o = currentOwner;
  if (!o || o._context[ServerComponentContext.id] !== true) return null;
  const name = context.id.description;
  return new Error(
    `Context${name ? ` "${name}"` : ""} cannot be read inside a server component. ` +
      "Server components render standalone on refetches and mutations, so app-level " +
      "providers do not cross the boundary. Pass the value as an argument, render the " +
      "provider inside the server component, or read per-request state via getRequestEvent()."
  );
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

// SSR is pull-based with no scheduler, so there is no halt state to reset.
export function resetErrorHalt() {}

// The client error hook has no server half: a server render's failures
// reach `configureServerErrors` (see @solidjs/web). Stubs so isomorphic
// setup code can call the client registration unguarded.
export interface ClientErrorContext {
  ownerPath?: string[];
}
export type ClientErrorHook = (error: unknown, context: ClientErrorContext) => void;
export interface ClientErrorsConfig {
  onError?: ClientErrorHook;
}
export function configureClientErrors(_config: ClientErrorsConfig): void {}
/** @internal */
export const ROOT_ERROR_HOOK: unique symbol = Symbol.for("solid-js/root-error-hook") as any;

export function resolve<T>(fn: () => T): Promise<T> {
  throw new Error("resolve is not implemented on the server");
}

export function until<T>(
  fn: () => T,
  options?: { timeout?: number; signal?: AbortSignal }
): Promise<T> {
  throw new Error("until is not implemented on the server");
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

export function refresh<T>(
  target: Refreshable<T>
): Promise<T extends (...args: any) => infer V ? V : T> {
  // No re-ask happens on the server — the target is already quiescent, so
  // the promise resolves immediately with the current state (the accessor's
  // value, or the store node itself), matching the client's early-return
  // paths. An unready read resolves undefined rather than throwing from a
  // write-like call.
  if (typeof target !== "function") return Promise.resolve(target as any);
  try {
    return Promise.resolve((target as any)());
  } catch {
    return Promise.resolve(undefined as any);
  }
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

export function storeIsShallow(_proxy: any): boolean {
  return false;
}
export function storeHasFamily(_proxy: any): boolean {
  return false;
}
export function storeHasOptimisticFamily(_proxy: any): boolean {
  return false;
}
