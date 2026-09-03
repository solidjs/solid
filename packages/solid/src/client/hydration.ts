import {
  getOwner,
  NotReadyError,
  createLoadingBoundary as coreLoadingBoundary,
  createErrorBoundary as coreErrorBoundary,
  flush,
  runWithOwner,
  onCleanup,
  isDisposed,
  getNextChildId,
  peekNextChildId,
  createRevealOrder as coreRevealOrder,
  createMemo as coreMemo,
  createSignal as coreSignal,
  createOptimistic as coreOptimistic,
  createProjection as coreProjection,
  createStore as coreStore,
  createOptimisticStore as coreOptimisticStore,
  createRenderEffect as coreRenderEffect,
  createEffect as coreEffect,
  setSnapshotCapture,
  markSnapshotScope,
  releaseSnapshotScope,
  clearSnapshots,
  type Accessor,
  type ComputeFunction,
  type MemoOptions,
  type NoInfer,
  type Owner,
  type ProjectionOptions,
  type Refreshable,
  type Signal,
  type SignalOptions,
  type SourceAccessor,
  type Store,
  type StoreSetter,
  type RevealOrder,
  createOwner,
  createRoot,
  getContext,
  setContext,
  type Context
} from "@solidjs/signals";
import type { Element as SolidElement } from "../types.js";
import { IS_DEV } from "./core.js";

type HydrationSsrFields = {
  /**
   * Defer the SSR stream flush until this primitive's first value is
   * resolved. Lets late-resolving sources hold the document open
   * rather than forcing the surrounding `<Loading>` boundary to render
   * its fallback into the HTML. Server-only; ignored on the client.
   */
  deferStream?: boolean;
  /**
   * Hydration policy. Decides what initial value the client uses and
   * whether the compute re-runs.
   *
   * - `"server"` *(default)*: client uses the serialized server value
   *   as initial state. Compute does **not** re-run for the initial
   *   value — the serialized result is authoritative. Choose this when
   *   the compute is deterministic from server-available inputs.
   * - `"hybrid"`: client uses the serialized server value, then
   *   re-runs the compute to take over. Choose this for computes that
   *   mix server data with client-only signals (e.g. window size,
   *   user-locale).
   * - `"client"`: skip the server value entirely. Compute is deferred
   *   until hydration completes, then runs as if first-mounted.
   *   Choose this for client-only state where serialization is
   *   meaningless. Two forms decide what the pre-compute window
   *   renders: **bare** (structural) — the source suspends on the
   *   server as a final hole and the nearest `<Loading>` boundary
   *   renders its fallback, handing the position to the client; or a
   *   **declared commit #0** (value) — `loadingValue` on signal-family
   *   sources (`loadingValue: undefined` is a valid declaration),
   *   `seedLoadingValue: true` on store-family sources — which renders
   *   provisional data with no boundary involvement.
   */
  ssrSource?: "server" | "hybrid" | "client";
};
declare module "@solidjs/signals" {
  interface MemoOptions<T> extends HydrationSsrFields {}
  interface SignalOptions<T> extends HydrationSsrFields {}
  interface EffectOptions extends HydrationSsrFields {}
  interface ProjectionOptions extends HydrationSsrFields {}
}

/**
 * Options for `createProjection`, `createStore(fn, ...)`, and
 * `createOptimisticStore(fn, ...)`.
 *
 * `ssrSource` controls what initial value the client uses and whether
 * the projection's compute re-runs:
 *
 * - `"server"` *(default)*: client uses the serialized server value
 *   as initial state.
 * - `"hybrid"`: serialized value first, then re-run the compute on
 *   the client to take over.
 * - `"client"`: skip serialization; compute runs only after hydration
 *   completes. Bare = suspends on the server (nearest `<Loading>`
 *   renders its fallback and hands the position to the client);
 *   `seedLoadingValue: true` = the seed is the declared commit #0 and
 *   renders instead.
 *
 * See {@link HydrationSsrFields} for the fuller explanation.
 */
type HydrationMemoOptions<T> = MemoOptions<T>;
type HydrationSignalOptions<T> = SignalOptions<T> & MemoOptions<T>;
type HydrationProjectionOptions = ProjectionOptions;

export type HydrationContext = {};

/**
 * Internal context flag set by `<NoHydration>` to disable hydration for its
 * subtree. Cross-package wiring; not part of the user-facing API.
 *
 * @internal
 */
export const NoHydrateContext: Context<boolean> = {
  id: Symbol("NoHydrateContext"),
  defaultValue: false
};

type SharedConfig = {
  hydrating: boolean;
  resources?: { [key: string]: any };
  load?: (id: string) => Promise<any> | any;
  has?: (id: string) => boolean;
  gather?: (key: string) => void;
  /**
   * Per-boundary capture of the root-scoped registry/gather pair, installed
   * by the DOM runtime's hydrate(). Boundary registration stores the current
   * pair keyed by the full boundary id; the resume path swaps it in for its
   * synchronous window so a late resume claims against the root it
   * registered under, not whichever root hydrated last (#2917). Entries are
   * removed when the boundary's pending count releases.
   */
  boundaryScopes?: Map<string, { registry?: Map<string, object>; gather?: (key: string) => void }>;
  captureBoundaryScope?: (id: string) => void;
  cleanupFragment?: (id: string) => void;
  loadModuleAssets?: (mapping: Record<string, string>) => Promise<void> | undefined;
  registry?: Map<string, object>;
  completed?: WeakSet<object> | null;
  events?: any[] | null;
  verifyHydration?: () => void;
  done: boolean;
  // Assigned by enableHydration(); callers only reach it behind a
  // `sharedConfig.hydrating` check, which can never be true before that.
  getNextContextId?: () => string;
  /**
   * Whether a hydration pass is still claiming server-rendered DOM — true
   * from hydrate()'s synchronous walk until every streamed boundary has
   * resumed or been cancelled. Consumed by dev tooling (the refresh runtime
   * defers hot swaps that would race the claim, #2919). Assigned by
   * enableHydration(); absent in CSR bundles and on the server sharedConfig —
   * treat absence as "not hydrating". Cross-package wiring; not part of the
   * user-facing API.
   *
   * @internal
   */
  isHydrationInProgress?: () => boolean;
  /**
   * Registers a callback to run once when all hydration completes (all
   * boundaries hydrated or cancelled). If hydration is already complete (or
   * not hydrating), fires via queueMicrotask. Assigned by enableHydration();
   * absent in CSR bundles and on the server sharedConfig — when absent,
   * hydration is definitionally complete, so fire the callback via
   * queueMicrotask yourself. Cross-package wiring; not part of the
   * user-facing API.
   *
   * @internal
   */
  onHydrationEnd?: (callback: () => void) => void;
};

/**
 * Shared hydration coordination object — populated by `enableHydration()` and
 * consumed by the hydration-aware primitive wrappers and SSR streaming
 * runtime. Cross-package wiring; not part of the user-facing API.
 *
 * @internal
 */
export const sharedConfig: SharedConfig = {
  hydrating: false,
  registry: undefined,
  done: false
};

// Installed on sharedConfig by enableHydration(): defining it in the object
// literal above retains getContext/NoHydrateContext/getNextChildId (and the
// signals context/error machinery behind them) in every CSR bundle that
// imports sharedConfig, i.e. all of them (#2883 phase 3).
function hydrationGetNextContextId(): string {
  const o = getOwner();
  if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
  if (getContext(NoHydrateContext)) return undefined as unknown as string;
  return getNextChildId(o);
}

// === Hydration phase API ===

let _hydrationEndCallbacks: (() => void)[] | null = null;
let _pendingBoundaries = 0;
let _hydrationDone = false;
let _snapshotRootOwner: Owner | null = null;

function markTopLevelSnapshotScope() {
  if (_snapshotRootOwner) return;
  let owner: Owner | null = getOwner();
  if (!owner) return;
  while (owner._parent) owner = owner._parent;
  markSnapshotScope(owner);
  _snapshotRootOwner = owner;
}

// Whether a hydration pass is still claiming server-rendered DOM. Reached by
// the refresh runtime as `sharedConfig.isHydrationInProgress` (#2919) —
// deliberately NOT a named export so app code isn't invited to branch on
// hydration state.
function isHydrationInProgress(): boolean {
  return !_hydrationDone && (sharedConfig.hydrating || _pendingBoundaries > 0);
}

// Registers a callback to run once when all hydration completes (all
// boundaries hydrated or cancelled). If hydration is already complete (or not
// hydrating), fires via queueMicrotask. Reached as
// `sharedConfig.onHydrationEnd`.
function onHydrationEnd(callback: () => void): void {
  if (_hydrationDone || (!sharedConfig.hydrating && _pendingBoundaries === 0)) {
    queueMicrotask(callback);
    return;
  }
  if (!_hydrationEndCallbacks) _hydrationEndCallbacks = [];
  _hydrationEndCallbacks.push(callback);
}

function drainHydrationCallbacks() {
  if (_hydrationDone) return;
  _hydrationDone = true;
  _doneValue = true;
  clearSnapshots();
  setSnapshotCapture(false);
  flush();
  const cbs = _hydrationEndCallbacks;
  _hydrationEndCallbacks = null;
  if (cbs) for (const cb of cbs) cb();
  setTimeout(() => {
    if (IS_DEV && sharedConfig.verifyHydration) sharedConfig.verifyHydration();
    if ((globalThis as any)._$HY) (globalThis as any)._$HY.done = true;
    sharedConfig.registry?.clear();
  });
}

function checkHydrationComplete() {
  // Not while a root's synchronous pass is running: a disposal-time release
  // (#2917) may hit zero while another root is still claiming DOM.
  if (!_hydratingValue && _pendingBoundaries === 0) drainHydrationCallbacks();
}

// Backing values for property interceptors (installed by enableHydration)
let _hydratingValue = false;
let _doneValue = false;

// === Override slots for hydration-aware primitives (tree-shakeable) ===
// Only assigned inside enableHydration(). If enableHydration is never called
// (no hydrate() import), the hydrated* functions and their dependencies
// (MockPromise, subFetch) are eliminated by the bundler.

let _createMemo: Function | undefined;
let _createSignal: Function | undefined;
let _createErrorBoundary: Function | undefined;
let _createRenderEffect: Function | undefined;
let _createEffect: Function | undefined;
let _createLoadingBoundary: Function | undefined;
// The store/optimistic families get GENERIC adapters instead of one slot per
// primitive: the adapter is parameterized by the core implementation, and
// each wrapper below passes its own (createStore hands in coreStore, etc.).
// This keeps the store engine (store/reconcile/projection/optimistic in
// @solidjs/signals, ~7 KB gz) out of enableHydration()'s reference graph —
// it is retained by the wrapper, i.e. only when the app imports the
// primitive. A hydrating app with no store usage shakes the whole engine; an
// app that uses stores gets exactly the same hydration behavior as before,
// because the adapter travels with enableHydration() and the engine with the
// import the app already has. There is no state where a hydrating store call
// can miss its adapter: `sharedConfig.hydrating` can only be true after
// enableHydration() installed these.
let _hydrateSignalLike: ((coreFn: Function, fn: any, options?: any) => any) | undefined;
let _hydrateStoreLike:
  | ((coreFn: Function, fn: any, initialValue: any, options?: any) => any)
  | undefined;
// lazy()'s server-module lookup: only meaningful under hydration, so the
// implementation (and peekNextChildId/_$HY access behind it) installs here
// rather than shipping in CSR bundles that use lazy() (#2883 phase 3).
export let _lazyHydrationLookup:
  | (<T>(
      comp: (() => T | undefined) | undefined,
      moduleUrl?: string,
      exportName?: string
    ) => (() => T) | undefined)
  | undefined;

// --- Hydration helpers ---

// A `static {}` block marks the class as side-effectful, so bundlers retain
// it in EVERY client bundle even with zero references; the PURE-annotated
// factory shakes with its only consumer, subFetch (#2883 phase 3).
const MockPromise = /* @__PURE__ */ (() => {
  class MockPromise {
    catch() {
      return new MockPromise();
    }
    then() {
      return new MockPromise();
    }
    finally() {
      return new MockPromise();
    }
  }
  for (const k of ["all", "allSettled", "any", "race", "reject", "resolve"] as const) {
    (MockPromise as any)[k] = () => new MockPromise();
  }
  return MockPromise;
})();

function subFetch<T>(fn: (prev?: T) => any, prev?: T) {
  const ogFetch = fetch;
  const ogPromise = Promise;
  try {
    window.fetch = () => new MockPromise() as any;
    Promise = MockPromise as any;
    const result = fn(prev);
    if (result && typeof result[Symbol.asyncIterator] === "function") {
      result[Symbol.asyncIterator]().next();
    }
    // The trace run's flight is never consumed (the serialized value is
    // authoritative) — an async fn returns a REAL promise (engine-internal,
    // the MockPromise swap can't intercept it), so a rejecting compute
    // (#2997: server-rejected async adopted on the client) must be observed
    // here or it surfaces as an unhandled rejection.
    if (result && typeof result.then === "function") result.then(undefined, () => {});
    return result;
  } finally {
    window.fetch = ogFetch;
    Promise = ogPromise;
  }
}

function syncThenable(value: any) {
  return {
    then(fn: any) {
      fn(value);
    }
  };
}

/**
 * Unwrap a serialized hydration map entry. Only call when the map HAS an
 * entry for this id — presence is the caller's decision (`sharedConfig.has`),
 * because the serialized value itself may be null/undefined (#2914).
 *
 * Settled serialization refs are (promise) objects stamped with a numeric
 * status `s` (1 = fulfilled, 2 = rejected) and payload `v`. The payload is
 * read directly — `v ?? ref` would leak the ref object for nullish payloads.
 */
function readHydratedValue(initP: any, refresh: () => void, options?: any) {
  refresh();
  if (initP != null && typeof initP === "object") {
    // Commit #0 (loadingValue/seedLoadingValue): the server flushed markup
    // from the loading value, so the hydrating client must serve the same
    // value through the synchronous claim walk — a settled landing must NOT
    // unwrap synchronously here (structure computed from the real data would
    // claim against placeholder DOM). Hand the async runtime a clean thenable
    // (the settled refs are stamped `s`/`v`, which the core would also
    // fast-adopt): the landing applies on the microtask after the walk.
    if (hasLoadingWindow(options) && typeof initP.then === "function")
      return { then: initP.then.bind(initP) };
    if (initP.s === 2) {
      // The stamp is the consumption: nothing ever `.then`s the serialized
      // promise itself, so observe its rejection here or the deserialized
      // record surfaces as an unhandled rejection (#2997).
      if (typeof initP.then === "function") initP.then(undefined, () => {});
      throw initP.v;
    }
    if (initP.s === 1) return initP.v;
  }
  return initP;
}

/**
 * Nodes that have taken the serialized-adoption path once. Any LATER entry
 * means a dependency changed while the node was held on its server value —
 * the recompute itself is absorbed (the latch re-serves the serialized
 * value, as it must), and with the node then clean, nothing would ever
 * re-run it after hydration: the mid-stream change would be silently lost,
 * not deferred. Arming the takeover gate on that re-entry re-runs exactly
 * the diverged nodes against their live sources when hydration ends.
 * (Async settles commit through the adopted thenable without re-entering
 * the wrapper, so re-entry here is always invalidation-driven.)
 */
const latchedOnce = new WeakSet<object>();

/** Shared “serialized init or run compute” path for memo/signal/optimistic/effect under hydration. */
function readSerializedOrCompute(compute: (prev: any) => any, prev: any, options?: any) {
  const o = getOwner()!;
  // A computation must adopt its serialized server value for the whole
  // hydration lifecycle (`!done`), not just inside a synchronous resume window.
  // A streamed section can recompute between chunks; running the client body
  // there would commit a fresh Promise and orphan the server-streamed fragment.
  // So short-circuit to the server value whenever one is still waiting; once
  // hydration is `done`, always compute.
  if (sharedConfig.done || !sharedConfig.has!(o.id!)) return compute(prev);
  // Divergence arming is a "server"/default-mode contract only: the hybrid
  // signal-like wrapper runs this path under withHydrationGate, whose
  // synchronous flip guarantees one internal re-entry that is not user
  // divergence — and hybrid's sync/promise flavor deliberately latches
  // (re-running its compute at done would clobber the adopted value).
  if (latchedOnce.has(o)) {
    if (options?.ssrSource !== "hybrid") armLiveTakeover();
  } else latchedOnce.add(o);
  return readHydratedValue(
    sharedConfig.load!(o.id!),
    () => {
      const traced = subFetch(compute, prev);
      if (options?.ssrSource !== "hybrid" && traced != null && traced[LIVE_SOURCE])
        armLiveTakeover();
      return traced;
    },
    options
  );
}

/**
 * A thenable that never settles. The pre-hydration gate on an
 * `ssrSource: "client"` source returns this instead of prev: a sync return
 * would count as the node's first real answer — for a loading-window node it
 * would close the window, making the post-hydration compute pending-class
 * (isPending true) even though that compute IS the node's first question;
 * for a bare node it would commit `undefined` as an observed answer. A
 * never-landing flight keeps the node unasked through the gate — commit #0
 * (when declared) serves verdict-quiet, a bare node stays uninitialized —
 * until the real first flight lands, exactly like a fresh CSR mount. The
 * gate flip's recompute supersedes it (`_inFlight` is replaced; the
 * callbacks never fire), so sharing one frozen instance is safe.
 */
const UNASKED: PromiseLike<never> = { then() {} } as any;

/**
 * Live-source brand (registered symbol — set by the transport's `live()`
 * declaration; registered so separately bundled copies agree). See the
 * server counterpart in server/signals.ts: the server takes a live
 * source's first value and closes (auto-hybrid), so the client's adopted
 * value is only the t=0 face — the node must re-run its compute after
 * hydration to reconnect. The brand is detected in the trace run the
 * adoption path already performs (subFetch invokes the compute; a live
 * call constructs its iterable synchronously with no wire activity).
 */
const LIVE_SOURCE = Symbol.for("solid.LiveSource");

// One shared gate for all live-armed nodes in a hydration pass: nodes that
// trace-detected a live compute read it (tracked); hydration end flips it,
// recomputing exactly those nodes — whose compute wrapper now sees
// `sharedConfig.done` and runs the real compute, reconnecting. The stale
// adopted value serves until the reconnect's first yield lands (pending
// recomputes serve prev), so takeover is seam-free. The gate is discarded
// on flip so a later hydration pass (islands) arms a fresh one.
let liveGate: (() => boolean) | undefined;
function armLiveTakeover() {
  if (!liveGate) {
    const [read, write] = coreSignal(false);
    liveGate = read;
    onHydrationEnd(() => {
      liveGate = undefined;
      write(true);
    });
  }
  liveGate();
}

/** Options carry commit #0 — the loading window must hold through the claim walk. */
function hasLoadingWindow(options: any): boolean {
  return (
    options != null &&
    typeof options === "object" &&
    ("loadingValue" in options || options.seedLoadingValue === true)
  );
}

function forwardIteratorReturn(it: any, value?: any) {
  const returned = it.return?.(value);
  return returned && typeof returned.then === "function"
    ? returned
    : syncThenable(returned ?? { done: true, value });
}

function normalizeIterator(it: any, deferFirst?: boolean) {
  let first = true;
  let buffered: any = null;
  return {
    next() {
      if (first) {
        first = false;
        const r = it.next();
        if (r && typeof r.then === "function") return r;
        // Loading window (loadingValue): commit #0 must serve through the
        // synchronous claim walk. A fully-buffered replay (loaded mode)
        // delivers its first yield synchronously, which would close the
        // window mid-walk — the client would compute real-data structure
        // against placeholder markup. Defer it one microtask; the sync
        // delivery stays for windowless nodes, whose claim NEEDS the value.
        return deferFirst ? Promise.resolve(r) : syncThenable(r);
      }
      if (buffered) {
        const b = buffered;
        buffered = null;
        return b;
      }
      let latest = it.next();
      if (latest && typeof latest.then === "function") return latest;
      let result = latest;
      while (!latest.done) {
        const peek = it.next();
        if (peek && typeof peek.then === "function") {
          buffered = peek;
          break;
        }
        latest = peek;
        // Conflate the buffered backlog to its LATEST data yield — one visible
        // update, the same final state the store path's batched patch
        // application produces. The stream's done result must not clobber
        // that value (a completed-before-hydration stream buffers its done
        // result right behind the data): deliver the value from this pull and
        // hand the done result to the next one.
        if (!latest.done) result = latest;
        else if (result !== latest) buffered = Promise.resolve(latest);
      }
      return Promise.resolve(result);
    },
    return(value?: any) {
      buffered = null;
      return forwardIteratorReturn(it, value);
    }
  };
}

function applyPatches(target: any, patches: any[]) {
  for (const patch of patches) {
    const path = patch[0];
    let current = target;
    for (let i = 0; i < path.length - 1; i++) current = current[path[i]];
    const key = path[path.length - 1];
    if (patch.length === 1) {
      Array.isArray(current) ? current.splice(key as number, 1) : delete current[key];
    } else if (patch.length === 3) {
      (current as any[]).splice(key as number, 0, patch[1]);
    } else {
      current[key] = patch[1];
    }
  }
}

function isAsyncIterable(v: any): boolean {
  return v != null && typeof v[Symbol.asyncIterator] === "function";
}

function createShadowDraft(realDraft: any) {
  const shadow = JSON.parse(JSON.stringify(realDraft));
  let useShadow = true;
  return {
    proxy: new Proxy(shadow, {
      get(_, prop) {
        return useShadow ? shadow[prop] : realDraft[prop];
      },
      set(_, prop, value) {
        if (useShadow) {
          shadow[prop] = value;
          return true;
        }
        return Reflect.set(realDraft, prop, value);
      },
      deleteProperty(_, prop) {
        if (useShadow) {
          delete shadow[prop];
          return true;
        }
        return Reflect.deleteProperty(realDraft, prop);
      },
      has(_, prop) {
        return prop in (useShadow ? shadow : realDraft);
      },
      ownKeys() {
        return Reflect.ownKeys(useShadow ? shadow : realDraft);
      },
      getOwnPropertyDescriptor(_, prop) {
        return Object.getOwnPropertyDescriptor(useShadow ? shadow : realDraft, prop);
      }
    }),
    activate() {
      useShadow = false;
    }
  };
}

function wrapFirstYield(iterable: any, activate: () => void) {
  const srcIt = iterable[Symbol.asyncIterator]();
  let first = true;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          const p = srcIt.next();
          if (first) {
            first = false;
            return p.then((r: any) => {
              activate();
              return r.done ? r : { done: false, value: undefined };
            });
          }
          return p;
        },
        return(value?: any) {
          return forwardIteratorReturn(srcIt, value);
        }
      };
    }
  };
}

function hydrateSignalFromAsyncIterable(coreFn: Function, compute: any, options: any): any {
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has!(expectedId)) return null;
  const loaded = sharedConfig.load!(expectedId);
  if (!isAsyncIterable(loaded)) return null;

  const base = normalizeIterator(loaded[Symbol.asyncIterator](), hasLoadingWindow(options));
  // Terminal tracking for the live handover below. The wrapper thenable keeps
  // the base iterator's delivery timing: syncThenable runs its callback
  // synchronously, and windowless claims NEED that sync first value.
  let terminal = false;
  const it = {
    next() {
      const p = base.next();
      return {
        then(res: any, rej: any) {
          return p.then(
            (r: any) => {
              if (r.done) terminal = true;
              return res(r);
            },
            (e: any) => {
              terminal = true;
              if (rej) return rej(e);
              throw e;
            }
          );
        }
      };
    },
    return(value?: any) {
      return base.return(value);
    }
  };
  const iterable = {
    [Symbol.asyncIterator]() {
      return it;
    }
  };
  return coreFn((prev: any) => {
    // A run after the serialized stream reached its terminal state (done or
    // error) is a real invalidation — a dependency change or refresh() — and
    // the stream answers the OLD question (and is already consumed). Hand
    // over to the live compute (#3060). Runs BEFORE that are NotReady
    // retries of the same flight (e.g. the compute read a sibling async
    // source that was still pending) and must keep adopting the replay.
    if (terminal) return compute(prev);
    // Run the user compute up to its first await on the client so any reactive
    // dependencies read before the first suspension are tracked. subFetch mocks
    // fetch/Promise so the async generator cannot progress past that point —
    // the server iterator drives the actual values from here on.
    subFetch(compute, prev);
    return iterable;
  }, options);
}

function hydrateStoreFromAsyncIterable(
  coreFn: Function,
  fn: any,
  initialValue: any,
  options: any
): any {
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has!(expectedId)) return null;
  const loaded = sharedConfig.load!(expectedId);
  if (!isAsyncIterable(loaded)) return null;

  const srcIt = loaded[Symbol.asyncIterator]();
  const loading = hasLoadingWindow(options);
  let isFirst = true;
  let buffered: any = null;
  let terminal = false;
  const fail = (e: any) => {
    terminal = true;
    throw e;
  };
  return coreFn(
    (draft: any) => {
      // A run after the serialized stream reached its terminal state (done
      // or error) is a real invalidation — a dependency change or refresh()
      // — and the stream answers the OLD question (and is already consumed).
      // Re-running the adoption body would orphan another subFetch generator
      // and hand back the dead replay, freezing the store at its SSR value
      // forever; hand over to the live fn instead (#3060). Runs BEFORE the
      // terminal are NotReady retries of the same flight — the derive
      // re-runs each time a pending pull lands — and must keep adopting the
      // shared replay (going live there re-fetches data the document is
      // still delivering).
      if (terminal) return fn(draft);
      // Run the user fn up to its first await on the client so any reactive
      // dependencies read before the first suspension are tracked. Writes go
      // to a shadow of the draft and are discarded — the server iterator is
      // authoritative and drives the real draft via the iterable below.
      const { proxy } = createShadowDraft(draft);
      subFetch(fn, proxy);
      const process = (res: any) => {
        if (res.done) {
          terminal = true;
          return { done: true, value: undefined };
        }
        if (isFirst) {
          isFirst = false;
          // The initial full value IS the snapshot state the SSR DOM reflects.
          // Disable snapshot capture while applying it so prepareStoreWrite doesn't
          // record the pre-write (empty) base as the snapshot — otherwise reads
          // during hydration (e.g. Repeat reading length) see the stale pre-value
          // and fail to match the server-rendered DOM.
          setSnapshotCapture(false);
          try {
            if (Array.isArray(res.value)) {
              for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
              draft.length = res.value.length;
            } else {
              // Replace, not merge: the snapshot is the full authoritative
              // state, so seed keys absent from it were removed on the server
              // and must not survive on the client either (#2948).
              for (const key of Object.keys(draft)) {
                if (!(key in res.value)) delete draft[key];
              }
              Object.assign(draft, res.value);
            }
          } finally {
            setSnapshotCapture(true);
          }
        } else {
          applyPatches(draft, res.value);
        }
        return { done: false, value: undefined };
      };
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (isFirst) {
                const r = srcIt.next();
                if (r && typeof r.then === "function")
                  return {
                    then(fn: any, rej: any) {
                      r.then(
                        (v: any) => {
                          // process() can throw (a store-trap NotReadyError,
                          // a reconcile failure). A throw inside this
                          // onFulfilled would reject a derived promise
                          // nobody observes — silently killing the drain and
                          // wedging the projection forever. Route it to the
                          // flight's rejection instead.
                          let out;
                          try {
                            out = process(v);
                          } catch (e) {
                            terminal = true;
                            rej(e);
                            return;
                          }
                          fn(out);
                        },
                        (e: any) => {
                          terminal = true;
                          rej(e);
                        }
                      );
                    }
                  };
                if (loading) {
                  // Seed window (seedLoadingValue): the SSR DOM reflects the
                  // SEED (commit #0), not the first-yield snapshot — the sync
                  // application below exists precisely because for windowless
                  // stores the snapshot IS what the DOM shows. Here applying
                  // it mid-claim would hydrate real-data structure against
                  // seed markup, so the snapshot parks until hydration
                  // completes, exactly like the patch backlog.
                  return new Promise(resolvePull => {
                    onHydrationEnd(() => resolvePull(process(r)));
                  });
                }
                return syncThenable(process(r));
              }
              if (buffered) {
                const b = buffered;
                buffered = null;
                return b.then(process, fail);
              }
              let r = srcIt.next();
              if (r && typeof r.then === "function") {
                return r.then(process, fail);
              }
              // A synchronously-available result is buffered backlog — the
              // stream ran ahead of hydration (delayed client script). It
              // must NOT apply while hydration is still claiming server DOM:
              // this pull runs inside the claim pass that first reads the
              // store (Repeat reading `length` drives it), or — for a late
              // streamed boundary — on a microtask racing that boundary's
              // resume. Projection draft writes stage in the override layer
              // until the firewall commits, so write-time snapshot capture
              // records the still-uncommitted SEED as the pre-write base
              // (not the first-yield state the SSR DOM shows), and any claim
              // pass after the batch hydrates against pre-stream state —
              // orphaning every server-rendered row. Park the batch until
              // hydration completes (a plain microtask when it already has):
              // snapshots are cleared by then, exactly where a live stream's
              // yields land. Conflated single-update semantics are kept —
              // every sync-available patch list still applies in one pull,
              // in order.
              return new Promise(resolvePull => {
                onHydrationEnd(() => {
                  let result = process(r);
                  while (!r.done) {
                    const peek = srcIt.next();
                    if (peek && typeof peek.then === "function") {
                      buffered = peek;
                      break;
                    }
                    r = peek;
                    if (!r.done) result = process(r);
                  }
                  resolvePull(result);
                });
              });
            },
            return(value?: any) {
              buffered = null;
              return forwardIteratorReturn(srcIt, value);
            }
          };
        }
      };
    },
    initialValue,
    options
  );
}

/**
 * Materialize a container TRACE — snapshot then patch batches, the
 * continuation protocol a server projection serializes as when it crosses a
 * boundary (hydration resume above; the slot border via the serializer's
 * container plugin) — into a live local projection. The result reads like
 * the server value did: not-ready until the snapshot lands, then a
 * read-only store the batches keep updating, done when the trace ends.
 *
 * Created DETACHED (`runWithOwner(null)`): revival can run inside a render
 * effect's owner, and the store is memoized per trace (see the plugin's
 * WeakMap) — a store owned by its first reader would be disposed by that
 * reader's re-render while other readers still hold it. Consumption is
 * pull-driven and the trace is response-bounded, so the projection settles
 * on its own; GC collects the pair with the trace.
 *
 * @internal — consumed by the serialization layer (@solidjs/web).
 */
export function materializeContainerTrace(marker: {
  $tr: AsyncIterable<any> | { __SEROVAL_STREAM__: true };
  $ta?: number;
}): Store<any> {
  const src = marker.$tr as any;
  // Raw seroval stream (the wire shape since the stream-mint protocol):
  // `.on()` replays buffered emissions SYNCHRONOUSLY, so a snapshot the
  // document already delivered is applied before the first read — the store
  // reads as READY during hydration's synchronous claim walk, matching the
  // page's settled markup. The async-iterable branch below (pre-stream
  // payloads) can only surface its buffer through microtasks, which made a
  // settled-inline boundary suspend at the walk and hydrate a phantom
  // fallback over settled markup (the chat welcome/status meter miss).
  if (src != null && src.__SEROVAL_STREAM__ === true) {
    const queue: any[] = [];
    let failed: { error: any } | undefined;
    let cursor = 0;
    let first = true;
    // Everything lives under the detached root (see the block comment
    // below): materialization runs at arg-read inside a reader's render
    // scope, and a version signal owned by that reader would be disposed by
    // its re-render while the memoized store lives on.
    return createRoot(() => {
      const [version, setVersion] = coreSignal(0);
      // Subscribe before creating the projection: the buffered replay runs
      // synchronously inside on(), filling the queue the first compute
      // drains. Replayed values must NOT bump the version — the replay can
      // run inside an owned render scope where reactive writes are illegal,
      // and the projection doesn't exist yet to need waking. Only live
      // emissions (stream callbacks on later tasks) bump.
      let live = false;
      const bump = () => live && setVersion(n => n + 1);
      src.on({
        next(value: any) {
          queue.push(value);
          bump();
        },
        // The trace ended: the last applied state latches (same contract as
        // the iterable path's `done`).
        return() {},
        throw(error: any) {
          failed = { error };
          bump();
        }
      });
      live = true;
      return createProjection(
        (draft: any) => {
          version();
          while (cursor < queue.length) {
            const value = queue[cursor++];
            if (first) {
              first = false;
              // Full authoritative snapshot into a fresh {}/[] seed — pure
              // writes, no draft reads (see the iterable branch below).
              if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) draft[i] = value[i];
                draft.length = value.length;
              } else {
                Object.assign(draft, value);
              }
            } else {
              applyPatches(draft, value);
            }
          }
          if (failed) throw failed.error;
          // Nothing buffered yet (revival raced ahead of the record's data
          // script): pending until the snapshot lands, marked on the
          // projection's own node — the version bump reruns this compute.
          if (first) throw new NotReadyError(getOwner());
        },
        (marker.$ta ? [] : {}) as any
      );
    })!;
  }
  // A root, not a bare null owner: the projection's async machinery routes
  // its pending/error states through the owner's queue, and with no owner
  // at all the internal NotReadyError (the "pending until snapshot" mark)
  // surfaces as an unhandled error in dev. The root is never disposed —
  // the projection settles itself when the trace ends and is collected
  // with the store.
  return createRoot(() =>
    createProjection(
      (draft: any) => ({
        [Symbol.asyncIterator]() {
          const srcIt = src[Symbol.asyncIterator]();
          let first = true;
          return {
            next: () =>
              Promise.resolve(srcIt.next()).then((res: any) => {
                if (res.done) return { done: true as const, value: undefined };
                if (first) {
                  first = false;
                  // The first yield is the full authoritative snapshot. The
                  // seed is a fresh empty {}/[] minted here, so this is pure
                  // writes — no reads of the draft, which is still PENDING
                  // (reading a pending proxy throws NotReadyError, which
                  // would reject this step and error the projection).
                  if (Array.isArray(res.value)) {
                    for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
                    draft.length = res.value.length;
                  } else {
                    Object.assign(draft, res.value);
                  }
                } else {
                  applyPatches(draft, res.value);
                }
                return { done: false as const, value: undefined };
              }),
            return: (value?: any) => forwardIteratorReturn(srcIt, value)
          };
        }
      }),
      (marker.$ta ? [] : {}) as any
    )
  )!;
}

// --- Hydration-aware implementations ---

// The shared pre-hydration gate lifecycle for the ssrSource branches
// (signal/store × client/hybrid): create the node with a compute that
// branches on the gate, then flip it — the flip's recompute is the node's
// first real run. `ownedWrite` because the write happens inside the node's
// own creation scope.
function withHydrationGate(create: (hydrated: () => boolean) => any) {
  const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
  const result = create(hydrated);
  setHydrated(true);
  return result;
}

// One signal-shaped hydration body for memo/signal/optimistic — the families
// only ever differed in which core primitive committed the result, so the
// core function is a parameter. createOptimistic reaches this through the
// _hydrateSignalLike slot precisely so the wrapper does not statically couple
// the optimistic engine to this body (which would drag it into CSR bundles).
function hydrateSignalLike(coreFn: Function, fn: any, options?: any) {
  markTopLevelSnapshotScope();

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    return withHydrationGate(hydrated =>
      coreFn((prev: any) => {
        // UNASKED (never prev) — a sync return would count as a first answer:
        // it would close a loading window before the real compute ever runs,
        // or commit `undefined` on a bare node (see UNASKED).
        if (!hydrated()) return UNASKED;
        return fn(prev);
      }, options)
    );
  }

  // Hybrid async-iterable takeover (#2993). The server consumes exactly one
  // yield from its iterator and serializes it as a plain promise — the
  // contract is that the CLIENT continues the iteration. Stores get that
  // through hydrateStoreLikeFn's shadow-draft re-run; without this branch a
  // signal-shaped node would adopt the first yield and latch there forever
  // (readSerializedOrCompute only re-runs the compute on invalidation).
  // Value semantics make the takeover simpler than the store's: re-run the
  // generator plainly — its first yield reproduces the value the server
  // rendered (hybrid's determinism contract, same assumption the store path
  // makes), so nothing needs discarding; equal values dedupe at the node.
  // The takeover only ARMS when the adoption pass saw an async-iterable
  // compute: sync and promise-shaped hybrid computes keep their documented
  // adopt-the-serialized-value semantics (re-running those would clobber the
  // server value / trigger a client refetch).
  if (ssrSource === "hybrid" && sharedConfig.has!(peekNextChildId(getOwner()!))) {
    let takeover = false;
    const detect = (prev: any) => {
      const r = fn(prev);
      takeover = isAsyncIterable(r);
      return r;
    };
    return withHydrationGate(hydrated =>
      coreFn((prev: any) => {
        if (hydrated() && takeover) return fn(prev);
        return readSerializedOrCompute(detect, prev, options);
      }, options)
    );
  }

  // "server", "hybrid", or undefined — use serialized value from server
  const aiResult = hydrateSignalFromAsyncIterable(coreFn, fn, options);
  if (aiResult !== null) return aiResult;

  return coreFn((prev: any) => readSerializedOrCompute(fn, prev, options), options);
}

function hydratedCreateMemo(compute: any, options?: any) {
  if (!sharedConfig.hydrating || options?.transparent) {
    return coreMemo(compute, options);
  }
  return hydrateSignalLike(coreMemo, compute, options);
}

function hydratedCreateSignal(fn?: any, second?: any) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return coreSignal(fn, second);
  return hydrateSignalLike(coreSignal, fn, second);
}

function hydratedCreateErrorBoundary<T, U>(
  fn: () => T,
  fallback: (error: () => unknown, reset: () => void) => U
): Accessor<T | U> {
  if (!sharedConfig.hydrating) return coreErrorBoundary(fn, fallback);
  markTopLevelSnapshotScope();
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (sharedConfig.has!(expectedId)) {
    const err = sharedConfig.load!(expectedId);
    if (err !== undefined) {
      let hydrated = true;
      return coreErrorBoundary(() => {
        if (hydrated) {
          hydrated = false;
          throw err;
        }
        return fn();
      }, fallback);
    }
  }
  return coreErrorBoundary(fn, fallback);
}

function wrapStoreFn(fn: any, options?: any) {
  return (draft: any) => readSerializedOrCompute(() => fn(draft), draft, options);
}

function hydrateStoreLikeFn(
  coreFn: Function,
  fn: any,
  initialValue: any,
  options: any,
  ssrSource: string | undefined
): any {
  if (ssrSource === "client") {
    return withHydrationGate(hydrated =>
      coreFn(
        (draft: any) => {
          // Keep client-only stores unasked through hydration. With
          // seedLoadingValue the seed is commit #0 and remains readable;
          // otherwise the store suspends until its first client result.
          if (!hydrated()) return UNASKED;
          return fn(draft);
        },
        initialValue,
        options
      )
    );
  }
  if (ssrSource === "hybrid") {
    return withHydrationGate(hydrated =>
      coreFn(
        (draft: any) => {
          const o = getOwner()!;
          if (!hydrated()) {
            if (sharedConfig.has!(o.id!))
              return readHydratedValue(
                sharedConfig.load!(o.id!),
                () => subFetch(fn, draft),
                options
              );
            return fn(draft);
          }
          const { proxy, activate } = createShadowDraft(draft);
          const r = fn(proxy);
          return isAsyncIterable(r) ? wrapFirstYield(r, activate) : r;
        },
        initialValue,
        options
      )
    );
  }
  const aiResult = hydrateStoreFromAsyncIterable(coreFn, fn, initialValue, options);
  if (aiResult !== null) return aiResult;
  return coreFn(wrapStoreFn(fn, options), initialValue, options);
}

// The store-shaped counterpart to hydrateSignalLike: one body for
// store/optimistic-store/projection, reached through the _hydrateStoreLike
// slot with the core implementation passed in by the wrapper. The buffered
// backlog parking in hydrateStoreFromAsyncIterable (and the module-local
// onHydrationEnd it defers through) is unchanged — only how the code is
// reached moved.
function hydrateStoreLike(coreFn: Function, fn: any, initialValue: any, options?: any) {
  markTopLevelSnapshotScope();
  return hydrateStoreLikeFn(coreFn, fn, initialValue, options, options?.ssrSource);
}

// --- Hydration-aware effect implementations ---

function hydratedEffect(coreFn: Function, compute: any, effectFn: any, options?: any) {
  if (!sharedConfig.hydrating || options?.transparent) return coreFn(compute, effectFn, options);

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    let active = false;
    withHydrationGate(hydrated =>
      coreFn(
        (prev: any) => {
          if (!hydrated()) return prev;
          active = true;
          return compute(prev);
        },
        (next: any, prev: any) => {
          if (!active) return;
          return effectFn(next, prev);
        },
        options
      )
    );
    return;
  }

  // "server", "hybrid", or undefined — use serialized value from server
  markTopLevelSnapshotScope();
  coreFn((prev: any) => readSerializedOrCompute(compute, prev), effectFn, options);
}

function hydratedCreateRenderEffect(compute: any, effectFn: any, options?: any) {
  return hydratedEffect(coreRenderEffect, compute, effectFn, options);
}

function hydratedCreateEffect(compute: any, effectFn: any, options?: any) {
  return hydratedEffect(coreEffect, compute, effectFn, options);
}

// --- Public API ---

/**
 * Switches the primitive wrappers above (`createMemo`, `createSignal`,
 * `createStore`, etc.) into hydration-aware mode. Called by `hydrate()`
 * before mounting; cross-package wiring not part of the user-facing API.
 *
 * @internal
 */
// The server keys the module mapping by the hydration id of lazy()'s render
// memo; compute the same id positionally (peek — the memo consumes the slot).
// This keeps module identity fully server-side: glob/dynamically composed
// lazy modules hydrate without a moduleUrl.
function lazyHydrationLookup<T>(
  comp: (() => T | undefined) | undefined,
  moduleUrl?: string,
  exportName?: string
): (() => T) | undefined {
  const o = getOwner();
  const key = o && o.id != null ? peekNextChildId(o) : undefined;
  const cached = key != null ? (globalThis as any)._$HY?.modules?.[key] : undefined;
  // Hydration resolves the component synchronously from the preloaded module
  // — its default export, or the call-site `export` option (a literal present
  // in both bundles, so the sync claim is preserved). A wrapper that selects
  // an export at runtime inside the import thunk cannot work here: the thunk
  // hasn't run, and rendering the raw namespace's default would silently
  // orphan the server DOM (#3011). Fail loudly in dev instead — there is no
  // supported async fallback during hydration.
  if (cached) {
    const component = exportName ? cached[exportName] : cached.default;
    if (IS_DEV && typeof component !== "function")
      throw new Error(
        `lazy() (hydration id "${key}") preloaded a module whose "${exportName ?? "default"}" ` +
          "export is not a component. lazy() hydrates synchronously from the preloaded " +
          "module; select a named export with the { export } option, or re-export the " +
          "component as the module's default. Wrappers that pick an export at runtime " +
          "inside the import thunk are not supported."
      );
    return () => component as T;
  }
  if (!comp && moduleUrl) {
    // moduleUrl present means the bundler transform ran, so the server
    // must have registered this position. A miss is a broken preload.
    throw new Error(
      `lazy() module "${moduleUrl}" (hydration id "${key}") was not preloaded before ` +
        "hydration. Ensure it is inside a Loading boundary."
    );
  }
  return comp as (() => T) | undefined;
}

export function enableHydration() {
  _createMemo = hydratedCreateMemo;
  _createSignal = hydratedCreateSignal;
  _createErrorBoundary = hydratedCreateErrorBoundary;
  // Generic adapters only: nothing installed here references the store
  // engine (coreStore/coreOptimisticStore/coreProjection/coreOptimistic) —
  // the wrappers pass those in, so a hydrating app that never imports a
  // store primitive shakes the engine entirely.
  _hydrateSignalLike = hydrateSignalLike;
  _hydrateStoreLike = hydrateStoreLike;
  _createRenderEffect = hydratedCreateRenderEffect;
  _createEffect = hydratedCreateEffect;
  _createLoadingBoundary = hydratedCreateLoadingBoundary;
  _lazyHydrationLookup = lazyHydrationLookup;
  sharedConfig.getNextContextId = hydrationGetNextContextId;
  // Installed here rather than in the sharedConfig literal so CSR bundles
  // shake the hydration-phase bookkeeping these close over. Consumers treat
  // absence as "not hydrating": the refresh runtime optional-chains
  // isHydrationInProgress, and clientOnly falls back to a bare microtask —
  // the exact CSR behavior onHydrationEnd itself had.
  sharedConfig.isHydrationInProgress = isHydrationInProgress;
  sharedConfig.onHydrationEnd = onHydrationEnd;

  // Take ownership of streamed-fragment reveals (see the fragment ledger).
  // The header script creates `_$HY` before any module runs, so the hook is
  // in place before the first `$df` the stream can emit under hydration —
  // and installing here (not module load) keeps CSR bundles free of it.
  const hy = (globalThis as any)._$HY;
  if (hy && !hy.fr) {
    if (!hy.f) hy.f = fragmentPolicy;
    // claim/release: the same claimant contract Loading boundaries use, for
    // integrations that own server-rendered markup wholesale (#2978 — the
    // frames document adoption claims the placeholders inside its region,
    // whose <Loading> producers ran on the server and have no client
    // boundary to ever register).
    hy.fr = {
      pending: anyFragmentPending,
      subscribe: subscribeFragments,
      claim: claimFragment,
      release: releaseFragment
    };
    // Every $dfr announces its swap through `_$HY.fe`; fanning it out here
    // gives ledger subscribers one channel for "content just landed".
    const prevFe = hy.fe;
    hy.fe = (id: string, parent?: ParentNode) => {
      prevFe && prevFe(id, parent);
      for (const sub of _revealSubs) sub(id, parent);
    };
    watchTruncation(hy);
  }

  _hydratingValue = sharedConfig.hydrating;
  _doneValue = sharedConfig.done;
  Object.defineProperty(sharedConfig, "hydrating", {
    get() {
      return _hydratingValue;
    },
    set(v: boolean) {
      const was = _hydratingValue;
      _hydratingValue = v;
      if (!was && v) {
        _hydrationDone = false;
        _doneValue = false;
        // Deliberately NOT zeroing _pendingBoundaries: a second hydration
        // root can start while an earlier root still has pending boundaries
        // (#2917). The counter spans roots — hydration is globally done only
        // when every root's boundaries have resumed.
        setSnapshotCapture(true);
        _snapshotRootOwner = null;
      } else if (was && !v) {
        if (_snapshotRootOwner) {
          releaseSnapshotScope(_snapshotRootOwner);
          _snapshotRootOwner = null;
        }
        checkHydrationComplete();
      }
    },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(sharedConfig, "done", {
    get() {
      return _doneValue;
    },
    set(v: boolean) {
      _doneValue = v;
      if (v) drainHydrationCallbacks();
    },
    configurable: true,
    enumerable: true
  });
}

// Wrapped primitives — delegate to override or core

/**
 * Creates a readonly derived reactive memoized signal.
 *
 * `compute(prev)` runs reactively — every reactive read inside it is
 * tracked, and the returned value becomes the memo's current value.
 * The memo is cached: it only recomputes when one of its tracked
 * sources changes.
 *
 * ```ts
 * const value = createMemo<T>(compute, options?: MemoOptions<T>);
 * ```
 *
 * @example
 * ```ts
 * const [first, setFirst] = createSignal("Ada");
 * const [last, setLast] = createSignal("Lovelace");
 *
 * const fullName = createMemo(() => `${first()} ${last()}`);
 *
 * fullName(); // "Ada Lovelace"
 * ```
 *
 * @example
 * ```ts
 * // Async memo — reads suspend inside <Loading>
 * const user = createMemo(async () => {
 *   const res = await fetch(`/users/${id()}`);
 *   return res.json();
 * });
 * ```
 *
 * **Hydration:** `MemoOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`) that controls what initial
 * value the client uses and whether `compute` re-runs. See
 * {@link HydrationSsrFields}.
 *
 * @param compute receives the previous value, returns the new value
 * @param options `MemoOptions` — `id`, `name`, `equals`, `unobserved`,
 *   `lazy`, `transparent`, `ssrSource`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-memo
 */
export const createMemo: {
  // Commit #0 (loadingValue) removes the uninitialized window: the accessor
  // never reads undefined — even for `ssrSource: "client"`, where the loading
  // value serves until the post-hydration compute lands — and `prev` is
  // always T (the loading value seeds the first compute). Bare
  // `ssrSource: "client"` is the structural form: the source suspends on the
  // server as a FINAL hole and the nearest <Loading> hands off to the client.
  <T>(
    compute: ComputeFunction<NoInfer<T>, T>,
    options: HydrationMemoOptions<T> & { loadingValue: T }
  ): SourceAccessor<T>;
  <T>(
    compute: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationMemoOptions<T>
  ): SourceAccessor<T>;
} = ((...args: any[]) => {
  return (_createMemo || coreMemo)(...args);
}) as any;

/**
 * Creates a simple reactive state with a getter and setter.
 *
 * - **Plain form** — `createSignal(value, options?: SignalOptions<T>)`:
 *   stores a value; the setter writes a new value or applies an
 *   updater `(prev) => next`.
 * - **Function form (writable memo)** —
 *   `createSignal(fn, options?: SignalOptions<T> & MemoOptions<T>)`:
 *   the value is computed by `fn` like a memo, but the setter can
 *   locally override it (useful for optimistic edits over a derived
 *   default).
 *
 * ```ts
 * // Plain
 * const [count, setCount] = createSignal(0);
 *
 * count();              // 0
 * setCount(1);          // explicit value
 * setCount(c => c + 1); // updater
 *
 * // Writable memo: starts as `fn()`, can be locally overwritten.
 * const [user, setUser] = createSignal(() => fetchUser(userId()));
 * setUser({ ...user(), name: "Alice" }); // optimistic local edit
 * ```
 *
 * **Hydration:** in the function form, `SignalOptions & MemoOptions`
 * accepts an `ssrSource` field (`"server"` | `"hybrid"` | `"client"`)
 * that controls what initial value the client uses and whether `fn`
 * re-runs. See {@link HydrationSsrFields}.
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export const createSignal: {
  <T>(): Signal<T | undefined>;
  <T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
  // Commit #0 (loadingValue): never undefined, `prev` is always T — see
  // createMemo (bare "client" is the structural form there too).
  <T>(
    fn: ComputeFunction<NoInfer<T>, T>,
    options: HydrationSignalOptions<T> & { loadingValue: T }
  ): Signal<T>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationSignalOptions<T>
  ): Signal<T>;
} = ((...args: any[]) => {
  return (_createSignal || coreSignal)(...args);
}) as any;

/**
 * Internal primitive that backs the `<Errored>` flow control.
 * Catches errors thrown inside `fn` and renders `fallback(error,
 * reset)` instead. `error` is an accessor for the latest captured error;
 * `reset()` recomputes the failing sources so the boundary can attempt to recover.
 *
 * App code should use `<Errored fallback={...}>` directly. This primitive is
 * kept exported for renderer, test, and compatibility use, but it is not part
 * of the recommended application authoring surface.
 *
 * **Hydration:** if the server serialized an error for this boundary,
 * the client re-throws it on the first hydration pass so `fallback`
 * renders the same content the server emitted.
 *
 * @internal
 */
export const createErrorBoundary = ((...args: any[]) =>
  (_createErrorBoundary || coreErrorBoundary)(...args)) as <T, U>(
  fn: () => T,
  fallback: (error: Accessor<unknown>, reset: () => void) => U
) => Accessor<T | U>;

/**
 * Internal primitive that backs `<Reveal>` coordination of sibling loading
 * boundaries. App code should use `<Reveal>` directly.
 *
 * @internal
 */
export function createRevealOrder<T>(
  fn: () => T,
  options?: { order?: () => RevealOrder; collapsed?: () => boolean }
): T {
  return coreRevealOrder(fn, options);
}

/**
 * Creates an optimistic signal — a `Signal<T>` whose writes are
 * tentative inside an `action` transition: they show up immediately,
 * then auto-revert (or reconcile to the action's resolved value) once
 * the transition settles.
 *
 * Use this for single-value optimistic state. For collection-shaped
 * state, prefer `createOptimisticStore`.
 *
 * - **Plain form** — `createOptimistic(value, options?: SignalOptions<T>)`.
 * - **Function form** — `createOptimistic(fn, options?: SignalOptions<T> & MemoOptions<T>)`:
 *   the authoritative value is recomputed by `fn`; the optimistic
 *   overlay reverts after each transition.
 *
 * @example
 * ```ts
 * const [name, setName] = createOptimistic("Ada");
 *
 * const rename = action(function* (next: string) {
 *   setName(next);                 // optimistic
 *   yield api.rename(next);        // commits or reverts on settle
 * });
 * ```
 *
 * **Hydration:** in the function form, accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-optimistic-signal
 */
export const createOptimistic: {
  <T>(): Signal<T | undefined>;
  <T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
  // Commit #0 (loadingValue): never undefined, `prev` is always T — see
  // createMemo (bare "client" is the structural form there too).
  <T>(
    fn: ComputeFunction<NoInfer<T>, T>,
    options: HydrationSignalOptions<T> & { loadingValue: T }
  ): Signal<T>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationSignalOptions<T>
  ): Signal<T>;
} = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot; passing coreOptimistic in here (instead of a dedicated
  // hydrated impl installed by enableHydration) is what lets the optimistic
  // engine shake out of hydrating bundles that never import this primitive.
  return typeof args[0] === "function" && sharedConfig.hydrating
    ? _hydrateSignalLike!(coreOptimistic, args[0], args[1])
    : (coreOptimistic as Function)(...args);
}) as any;

/**
 * Creates a derived (projected) store — `createMemo` for stores. The
 * derive function receives a mutable draft and either mutates it in
 * place (canonical) or returns a new value. Either way the result is
 * reconciled against the previous draft by `options.key` (default
 * `"id"`), so surviving items keep their proxy identity — only
 * added/removed items are created/disposed.
 *
 * Returns the projected store directly (no setter — reads only).
 *
 * Reach for this when you want the structural-sharing / per-property
 * tracking of a store on top of a derived computation. For simple
 * read-only derivations, `createMemo` is lighter.
 *
 * @example
 * ```ts
 * // Mutation form — update individual fields on the draft.
 * const summary = createProjection<{ total: number; active: number }>(
 *   draft => {
 *     draft.total = users().length;
 *     draft.active = users().filter(u => u.active).length;
 *   },
 *   { total: 0, active: 0 }
 * );
 *
 * // Return form — produce a derived collection. Reconciled by `id`
 * // so each surviving user keeps the same store identity.
 * const activeUsers = createProjection<User[]>(
 *   () => allUsers().filter(u => u.active),
 *   []
 * );
 * ```
 *
 * **Hydration:** `ProjectionOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`) for the same client-vs-server
 * tradeoffs as the other primitives. See {@link HydrationSsrFields}.
 */
export const createProjection: <T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: Partial<T> | Store<NoFn<T>>,
  options?: HydrationProjectionOptions
) => Refreshable<Store<T>> = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot (see createOptimistic above for the retention story).
  return sharedConfig.hydrating
    ? _hydrateStoreLike!(coreProjection, args[0], args[1], args[2])
    : (coreProjection as Function)(...args);
}) as any;

type NoFn<T> = T extends Function ? never : T;

/**
 * Creates a deeply-reactive store backed by a Proxy. Reads track each
 * property accessed; only the parts that change trigger updates.
 *
 * Store properties hold **plain values**, not accessors. The proxy
 * already tracks reads per-property — wrapping a value in
 * `() => state.foo` produces a getter that *won't* track when called,
 * which looks like a reactivity bug but is just a category error. If
 * you have a signal-shaped piece of state, make it a property of the
 * store (`{ foo: 1 }`) rather than nesting an accessor inside
 * (`{ foo: () => signal() }`).
 *
 * The setter takes a **draft-mutating** function — mutate the draft
 * in place (canonical). The callback may also return a new value:
 * arrays are replaced by index (length adjusted), objects are
 * shallow-diffed at the top level (keys present in the returned value
 * are written, missing keys deleted). Use the return form for shapes
 * where mutation is awkward — most commonly removing items via
 * `filter`. The setter does **not** do keyed reconciliation; for
 * that, use the derived/projection form (or `createProjection`).
 *
 * - **Plain form** — `createStore(initialValue)`: wraps a value in a
 *   reactive proxy.
 * - **Derived form** — `createStore(fn, seed, options?)`: a
 *   *projection store* whose contents are computed by `fn(draft)`.
 *   `fn` may be sync, async, or an `AsyncIterable`; the projection's
 *   result reconciles against the existing store by `options.key`
 *   (default `"id"`) for stable identity.
 *
 * @example
 * ```ts
 * const [state, setState] = createStore({
 *   user: { name: "Ada", age: 36 },
 *   todos: [] as { id: string; text: string; done: boolean }[]
 * });
 *
 * // Canonical: mutate the draft in place.
 * setState(s => { s.user.age = 37; });
 * setState(s => { s.todos.push({ id: "1", text: "x", done: false }); });
 *
 * // Return form: reach for it when mutation is awkward.
 * setState(s => s.todos.filter(t => !t.done));               // remove items
 * setState(s => ({ ...s, user: { name: "Grace", age: 85 } })); // shallow replace
 * ```
 *
 * @example
 * ```ts
 * // Derived store — auto-fetches & reconciles by `id`.
 * const [users] = createStore(
 *   async () => fetch("/users").then(r => r.json()),
 *   [] as User[]
 * );
 * ```
 *
 * **Hydration:** the derived form accepts `ProjectionOptions`, including
 * an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export const createStore: {
  <T extends object = {}>(
    store: NoFn<T> | Store<NoFn<T>>,
    options?: { name?: string; shallow?: boolean }
  ): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot (see createOptimistic above for the retention story).
  return typeof args[0] === "function" && sharedConfig.hydrating
    ? _hydrateStoreLike!(coreStore, args[0], args[1] ?? {}, args[2])
    : (coreStore as Function)(...args);
}) as any;

/**
 * The store equivalent of `createOptimistic`. Writes inside an
 * `action` transition are tentative — they show up immediately but
 * auto-revert (or reconcile to the action's resolved value) once the
 * transition finishes.
 *
 * Use this for optimistic UI on collection-shaped data. For
 * single-value optimistic state, prefer `createOptimistic`.
 *
 * - **Plain form** — `createOptimisticStore(initialValue)`.
 * - **Derived form** — `createOptimisticStore(fn, seed, options?)`:
 *   a projection store whose authoritative value is recomputed by
 *   `fn` and whose optimistic overlay reverts after each transition.
 *
 * `options.key` defaults to `"id"`; specify it only when your data
 * uses a different identity field (e.g. `{ key: "uuid" }` or
 * `{ key: t => t.slug }`). Restating the default just adds noise.
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimisticStore<Todo[]>([]);
 *
 * // Mutation: optimistic add, then in-place reconcile to the saved row.
 * const addTodo = action(function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => { t.push({ id: tempId, text, pending: true }); });
 *   const saved = yield api.createTodo(text);
 *   setTodos(t => {
 *     const i = t.findIndex(x => x.id === tempId);
 *     if (i >= 0) t[i] = saved;
 *   });
 * });
 *
 * // Return form: filter is the natural shape for removal.
 * const removeTodo = action(function* (id: string) {
 *   setTodos(t => t.filter(x => x.id !== id));
 *   yield api.removeTodo(id);
 * });
 * ```
 *
 * **Hydration:** the derived form accepts `ProjectionOptions`, including
 * an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export const createOptimisticStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot (see createOptimistic above for the retention story).
  return typeof args[0] === "function" && sharedConfig.hydrating
    ? _hydrateStoreLike!(coreOptimisticStore, args[0], args[1] ?? {}, args[2])
    : (coreOptimisticStore as Function)(...args);
}) as any;

/**
 * Creates a reactive computation that runs during the render phase as
 * DOM elements are created and updated but not necessarily connected.
 *
 * Same compute/effect split as `createEffect` (`compute(prev)` tracks,
 * `effect(next, prev?)` runs imperatively), but scheduled inside the
 * render queue rather than after it. Reach for this only when
 * authoring renderer plumbing — app code should use `createEffect`.
 *
 * ```ts
 * createRenderEffect<T>(compute, effectFn, options?: EffectOptions);
 * ```
 *
 * **Hydration:** `EffectOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 * `transparent: true` makes the effect invisible to hydration entirely —
 * it consumes no hydration id slot and its compute runs live rather than
 * adopting the serialized server value — for client-only effects the
 * server never created.
 *
 * @example
 * ```ts
 * // Custom directive: bind an element's textContent to a reactive source
 * // synchronously during render. App code should use `createEffect` for
 * // post-render side effects.
 * function bindText(el: HTMLElement, source: () => string) {
 *   createRenderEffect(
 *     () => source(),
 *     value => { el.textContent = value; }
 *   );
 * }
 * ```
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-render-effect
 */
export const createRenderEffect: typeof coreRenderEffect = ((...args: any[]) =>
  (_createRenderEffect || coreRenderEffect)(...args)) as typeof coreRenderEffect;

/**
 * Creates a reactive effect with **separate compute and effect phases**.
 *
 * - `compute(prev)` runs reactively — *put all reactive reads here*.
 *   The returned value is passed to `effect` and is also the new
 *   "previous" value for the next run.
 * - `effect(next, prev?)` runs imperatively (untracked) after the
 *   queue flushes. *Put DOM writes / fetch / logging / subscriptions
 *   here.* It may return a cleanup function which runs before the
 *   next effect or on disposal.
 *
 * Reactive reads inside `effect` will *not* re-trigger this effect —
 * that's intentional. If you need a single-phase tracked effect, use
 * `createTrackedEffect` (with the tradeoffs noted there).
 *
 * Pass an `EffectBundle` (`{ effect, error }`) instead of a plain
 * function to intercept errors thrown from the compute or effect
 * phases.
 *
 * ```ts
 * createEffect<T>(compute, effectFn | { effect, error }, options?: EffectOptions);
 * ```
 *
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 *
 * createEffect(
 *   () => count(),                  // compute: tracks `count`
 *   value => console.log(value)     // effect: side effect
 * );
 *
 * setCount(1); // logs 1 after the next flush
 * ```
 *
 * @example
 * ```ts
 * createEffect(
 *   () => userId(),
 *   id => {
 *     const ctrl = new AbortController();
 *     fetch(`/users/${id}`, { signal: ctrl.signal });
 *     return () => ctrl.abort(); // cleanup before next run / disposal
 *   }
 * );
 * ```
 *
 * **Hydration:** `EffectOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 * `transparent: true` makes the effect invisible to hydration entirely —
 * it consumes no hydration id slot and its compute runs live rather than
 * adopting the serialized server value — for client-only effects the
 * server never created.
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-effect
 */
export const createEffect: typeof coreEffect = ((...args: any[]) =>
  (_createEffect || coreEffect)(...args)) as typeof coreEffect;

// === Loading component ===
function createBoundaryTrigger(): () => void {
  setSnapshotCapture(false);
  const [s, set] = coreSignal(undefined, { equals: false });
  s();
  setSnapshotCapture(true);
  return set;
}

function resumeBoundaryHydration(
  o: Owner,
  id: string,
  set: () => void,
  release: () => boolean,
  shouldHydrate = true
) {
  // Read before release(): releasing removes the boundaryScopes entry.
  const scope = sharedConfig.boundaryScopes?.get(id);
  // Disposal already released this boundary's pending count (#2917).
  if (!release()) return;
  if (isDisposed(o)) {
    checkHydrationComplete();
    return;
  }
  // A late resume must claim against the root this boundary registered
  // under — another hydrate() root may have replaced the global
  // registry/gather since (#2917). Swap the captured pair in for the
  // synchronous resume window; without a capture the live globals apply.
  const prevRegistry = sharedConfig.registry;
  const prevGather = sharedConfig.gather;
  if (scope) {
    sharedConfig.registry = scope.registry;
    sharedConfig.gather = scope.gather;
  }
  try {
    if (shouldHydrate) sharedConfig.gather?.(id);
    _hydratingValue = shouldHydrate;
    if (shouldHydrate) {
      markSnapshotScope(o);
      _snapshotRootOwner = o;
    }
    set();
    flush();
    if (shouldHydrate) _snapshotRootOwner = null;
    _hydratingValue = false;
    if (shouldHydrate) releaseSnapshotScope(o);
    flush();
  } finally {
    if (scope) {
      sharedConfig.registry = prevRegistry;
      sharedConfig.gather = prevGather;
    }
  }
  checkHydrationComplete();
}

function initBoundaryResume(
  o: Owner,
  id: string
): [trigger: () => void, resume: (shouldHydrate?: boolean) => void, release: () => boolean] {
  _pendingBoundaries++;
  // Capture the current root's registry/gather pair for this boundary's
  // late resume (#2917). Runs while the registering root's globals are live:
  // during its hydrate() pass, or — for nested streamed boundaries — inside
  // an ancestor's resume window where that root's pair is swapped in.
  sharedConfig.captureBoundaryScope?.(id);
  // Each registration releases its pending count exactly once — via resume,
  // the $$f asset path, or disposal. The counter now spans hydration roots
  // (#2917), so a boundary that can never resume must not hold global
  // hydration open forever.
  let released = false;
  const release = () => {
    if (released) return false;
    released = true;
    _pendingBoundaries--;
    sharedConfig.boundaryScopes?.delete(id);
    // Retire the fragment claim (see claimFragment): after this boundary
    // resumes or is disposed, a late swap must be held rather than landing
    // in a range nobody will claim.
    const claim = _fragments.get(id);
    if (claim) claim.claimed = false;
    return true;
  };
  onCleanup(() => {
    if (!isDisposed(o as Owner)) return;
    sharedConfig.cleanupFragment?.(id);
    if (release()) checkHydrationComplete();
  });
  const set = createBoundaryTrigger();
  return [
    set,
    shouldHydrate => resumeBoundaryHydration(o, id, set, release, shouldHydrate),
    release
  ];
}

// === The document fragment ledger (one reveal owner) ===
//
// The streaming layer's inline script owns only the parse-time swap
// MECHANICS ($dfr: replace the `pl-*` range with the template payload, then
// record the reveal as `_$HY.v[id] = 1`); this module owns the reveal
// POLICY, and it answers every "what may the document still deliver?"
// question from records rather than DOM scans. The ledger's states:
//
// - DECLARED: the serializer writes `<id>_fr` into `_$HY.r` the moment a
//   boundary registers a pending fragment, so a declaration always reaches
//   the client before the content it promises.
// - SETTLED: seroval marks the `_fr` ref (`.s`) when the resolving chunk
//   executes — the same task batch that carries the fragment's content.
// - REVEALED: `_$HY.v[id]`, marked by $dfr itself — valid across the
//   pre-boot window (swaps that ran before this module loaded are on
//   record too).
// - CLAIMED / HELD: this module's post-boot policy state below.
//
// enableHydration() installs `_$HY.f` — from that moment every `$df(id)`
// the stream emits routes here (the same one-owner handoff the head-patch
// runtime uses via `_$HY.h`) — and publishes the ledger as `_$HY.fr`
// ({ pending, subscribe, claim, release }) so integrations (the frames
// client's document adoption) share this one answer instead of scanning for
// `pl-*` templates or patching `_$HY.fe` themselves.
//
// Policy: while global hydration is still in progress, swaps proceed —
// boundaries are coming to claim them. Once hydration completes, a swap only
// proceeds when a claimant is on record for the id: a boundary inside a
// deferred claim scope (a frames slot fill, a lazy route module) can still
// be waiting on the fragment after global hydration reads as done, and its
// markup IS the boundary's content — swapping it with no claimant would
// leave inert nodes in a range the client may re-render (#2964). Unclaimed
// late swaps are HELD (placeholder, fallback, and template all stay in
// place) and replayed when their claimant registers.
const _fragments = new Map<string, { claimed?: boolean; held?: boolean }>();
const _truncated = new Set<string>();
const _revealSubs = new Set<(id: string, parent?: ParentNode) => void>();
const _truncationRejectors = new Map<string, (err: Error) => void>();

function fragmentState(id: string) {
  let f = _fragments.get(id);
  if (!f) _fragments.set(id, (f = {}));
  return f;
}

function fragmentPolicy(id: string) {
  const f = fragmentState(id);
  if (!_hydrationDone || f.claimed) return (globalThis as any).$dfr(id);
  f.held = true;
  return 0;
}

// A held swap replays the moment its boundary shows up — BEFORE any of the
// boundary's paths walk the DOM. This covers the settled path too: a held
// swap arrives in the same chunk that resolves the `<id>_fr` ref, so a
// boundary rendering later sees a settled ref and hydrates straight through
// assuming the content is in the DOM. It is, once this runs.
function replayHeldFragment(id: string) {
  const f = _fragments.get(id);
  if (f && f.held) {
    f.held = false;
    (globalThis as any).$dfr(id);
  }
}

// A boundary registering against a still-pending `<id>_fr` goes on record as
// the fragment's claimant, so a late swap lands for its resume to claim. The
// claim is cleared by release() when the boundary resumes or is disposed.
function claimFragment(id: string) {
  fragmentState(id).claimed = true;
  replayHeldFragment(id);
}

// Retire a claim (the disposal half of the ledger's claim/release seam):
// after the claimant is gone, a late swap must be held rather than landing
// in a range nobody will claim.
function releaseFragment(id: string) {
  const f = _fragments.get(id);
  if (f) f.claimed = false;
}

/**
 * May the document still deliver fragment `id`'s content? An unsettled
 * declaration is in flight; a settled one stays pending until its swap runs
 * — `_$HY.v` records completed swaps, and the content template still being
 * in the document covers every deferred-swap state at once (style-gated,
 * retry-queued, reveal-grouped, policy-held) without tracking each. A
 * settled declaration with neither was inlined into the shell — it never
 * streamed, nothing is coming. (getElementById is an id-table lookup, not
 * the tree scan this ledger replaces.)
 *
 * Content whose `pl-*` placeholder range is GONE can never swap either
 * (#2978, secondary defect): a frame refetch that morphs over the region
 * removes the placeholder, and the swap has nowhere to land — the stale
 * content template alone must not keep the ledger reading "in flight" for
 * the rest of the page's life. The placeholder always parses before its
 * content, so with the template present its absence can only mean removal.
 */
function fragmentPending(hy: any, id: string): boolean {
  if (_truncated.has(id)) return false;
  const ref = hy.r[id + "_fr"];
  if (!ref || typeof ref !== "object") return false;
  if (!ref.s) return true;
  if (hy.v && hy.v[id]) return false;
  if (!document.getElementById(id)) return false;
  return !!document.getElementById("pl-" + id);
}

/**
 * A settled declaration whose swap can no longer land: the `pl-*` placeholder
 * is still in the document (so $df never ran and the content wasn't inlined)
 * but no content template exists and none is coming (`.s` is set — the
 * resolving chunk already executed). This is the SUPERSEDED fragment shape:
 * an outer boundary settled first and shipped the converged branch, retiring
 * this fragment's markup before it streamed. Its DOM truth is the fallback.
 */
function fragmentSuperseded(id: string): boolean {
  const hy = (globalThis as any)._$HY;
  if (hy && hy.v && hy.v[id]) return false;
  if (document.getElementById(id)) return false;
  return !!document.getElementById("pl-" + id);
}

function anyFragmentPending(): boolean {
  const hy = (globalThis as any)._$HY;
  if (!hy || !hy.r) return false;
  for (const key in hy.r) {
    if (key.length > 3 && key.endsWith("_fr") && fragmentPending(hy, key.slice(0, -3))) {
      return true;
    }
  }
  return false;
}

function subscribeFragments(cb: (id: string, parent?: ParentNode) => void): () => void {
  _revealSubs.add(cb);
  return () => _revealSubs.delete(cb);
}

// Truncation (#2958): a stream that ends without settling its declarations
// would otherwise leave boundaries waiting forever. The parser finishing
// (DOMContentLoaded) is the document transport's close — any `_fr` still
// unsettled then can never settle, because the script that would resolve it
// executes during parse. Each one becomes a rejected fragment: an
// error-class write, distinguishable from a server-sent rejection by its
// error, surfaced through the boundary's normal rejection path. The sweep
// only arms when the runtime booted while the document was still streaming;
// a runtime loaded after parse can't tell a completed page from a truncated
// one and stays out of it.
function watchTruncation(hy: any) {
  if (typeof document === "undefined" || document.readyState !== "loading") return;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      if (!hy.r) return;
      for (const key in hy.r) {
        if (key.length <= 3 || !key.endsWith("_fr")) continue;
        const ref = hy.r[key];
        if (ref && typeof ref === "object" && !ref.s) markTruncated(hy, key.slice(0, -3));
      }
      // A macrotask later, on purpose: the fragment rejections above release
      // their boundaries through microtask chains (abort race -> resume ->
      // fresh render), and that teardown disposes the computations that
      // adopted pending owner-id refs while hydrating. Rejecting those refs
      // synchronously would race the disposal and land an unhandled error in
      // a still-live computation, halting the reactive system. After the
      // boundaries have released, whoever still holds a pending ref (keyed
      // consumers like the router's query channel, boundaries waiting on a
      // sync-serialized data ref) is exactly who needs the rejection.
      setTimeout(() => rejectTruncatedRefs(hy));
    },
    { once: true }
  );
}

// The fragment pass above releases BOUNDARIES, but the registry also carries
// plain serialized promises — owner-id computation values and library-keyed
// data refs (e.g. @solidjs/router's query channel). A truncated stream
// leaves those forever-pending too. The settle scripts execute during parse,
// so at DOMContentLoaded every still-pending seroval resolver ({p, s, f},
// kept in the cross-reference scope `self.$R` — indexed values on the
// global for the wire the hydration serializer emits, or inside per-scope
// arrays for scoped renders) is dead. What each one needs depends on who is
// left holding its promise:
//
// - A ref GONE from the registry was consumed one-shot by a keyed consumer
//   (the router deletes `_$HY.r[key]` on load) — that consumer holds the
//   bare promise and hangs permanently unless it actually rejects, and its
//   `.then` chain is built for rejections. Reject through the resolver.
//   Walking the resolvers rather than the registry keys is what reaches
//   these at all.
// - A ref STILL in the registry either was adopted by a live reactive
//   computation (owner-id channel — never deleted) or awaits a late reader.
//   Rejecting those promises raw lands an unhandled error inside live
//   computations (no boundary routes it — the fragment pass already
//   released the boundaries) and halts the reactive system. Deleting the
//   entry instead makes every future presence check (`sharedConfig.has`)
//   fall through to a fresh compute/fetch — recovery, not failure — while
//   already-adopted computations keep their pre-existing stall until their
//   sources re-run.
//
// Settled promises carry the status stamp (`.s`) the settle helpers write,
// and the fragment pass stamps rejected `_fr` declarations before this
// runs, so both are skipped.
function rejectTruncatedRefs(hy: any) {
  const R = (globalThis as any).$R;
  if (!R || typeof R !== "object") return;
  let registryKeys: Map<any, string> | undefined;
  const sweep = (entry: any) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.f !== "function" ||
      !entry.p ||
      typeof entry.p.then !== "function" ||
      entry.p.s
    )
      return;
    if (!registryKeys) {
      registryKeys = new Map();
      for (const key in hy.r) registryKeys.set(hy.r[key], key);
    }
    const key = registryKeys.get(entry.p);
    if (key !== undefined) {
      delete hy.r[key];
      return;
    }
    const err = new Error("Hydration value was truncated: the stream ended before it settled.");
    // Mirror seroval's failure helper: reject through the resolver and stamp
    // the promise's status for status-based readers.
    entry.f(err);
    entry.p.s = 2;
    entry.p.v = err;
    // Guard the harness itself against an unhandled-rejection report; the
    // consumer observes the rejection through its own chain.
    entry.p.then(undefined, () => {});
  };
  for (const key in R) {
    const value = R[key];
    if (Array.isArray(value)) for (const entry of value) sweep(entry);
    else sweep(value);
  }
}

function markTruncated(hy: any, id: string) {
  if (_truncated.has(id)) return;
  _truncated.add(id);
  const err = new Error(
    `Hydration fragment "${id}" was truncated: the stream ended before its content arrived.`
  );
  const ref = hy.r[id + "_fr"];
  if (ref && typeof ref === "object") {
    ref.s = 2;
    ref.v = err;
  }
  const reject = _truncationRejectors.get(id);
  if (reject) {
    _truncationRejectors.delete(id);
    reject(err);
  }
  // No parent argument distinguishes this from a reveal: subscribers
  // re-evaluate pending state rather than adopting new content.
  for (const sub of _revealSubs) sub(id);
}

// A boundary already waiting on `<id>_fr` when truncation is detected needs
// its wait to reject — the ref's promise itself can never settle. The abort
// promise loses the race to every normally-delivered fragment.
function fragmentAbort(id: string): Promise<never> {
  return new Promise<never>((_, reject) => _truncationRejectors.set(id, reject));
}

function waitAndResume(
  p: any,
  resume: (shouldHydrate?: boolean) => void,
  assetPromise?: Promise<void>,
  hydrateRejected = true,
  abort?: Promise<never>
) {
  // Settle data and assets independently: an asset error must not be written
  // into the data ref's rejected state, and a data rejection must still keep
  // its own hydrate semantics. (`p` may be an exotic thenable — coerce first.)
  // An abort promise (fragment truncation) races the data: its rejection
  // flows through the same rejected-state write as a server-sent rejection.
  const data: Promise<boolean> = (
    abort ? Promise.race([Promise.resolve(p), abort]) : Promise.resolve(p)
  ).then(
    () => {
      if (p && typeof p === "object") p.s = 1;
      return true;
    },
    (err: any) => {
      if (p && typeof p === "object") {
        p.s = 2;
        p.v = err;
      }
      return hydrateRejected;
    }
  );
  if (!assetPromise) {
    data.then(shouldHydrate => resume(shouldHydrate));
    return;
  }
  const assets = assetPromise.then(
    () => true,
    (err: any) => {
      reportAssetFailure(err);
      return false;
    }
  );
  Promise.all([data, assets]).then(([dataHydrate, assetsOk]) =>
    // Without its preloaded module the boundary can't claim server DOM —
    // render fresh so lazy's own import() retries through normal channels.
    resume(assetsOk ? dataHydrate : false)
  );
}

// A rejected module preload means the boundary's code can't hydrate the
// server DOM (lazy() has no module). Surface the error and resume with
// shouldHydrate=false: the boundary renders fresh client DOM and lazy's own
// import() retries through normal channels — never hang hydration silently.
function reportAssetFailure(err: any) {
  console.error("Hydration module preload failed; rendering boundary content on the client:", err);
}

function scheduleResumeAfterAssets(
  id: string,
  resume: (shouldHydrate?: boolean) => void,
  assetPromise?: Promise<void>
): boolean {
  sharedConfig.gather?.(id);
  const doResume = () => queueMicrotask(resume);
  if (assetPromise) {
    assetPromise.then(doResume, err => {
      reportAssetFailure(err);
      queueMicrotask(() => resume(false));
    });
    return true;
  }
  doResume();
  return false;
}

/**
 * Internal primitive that backs the `<Loading>` component. Returns a
 * computation that yields `fallback()` while async reads inside `fn` are
 * pending, and `fn()` once they have settled. App code should use `<Loading>`
 * directly. This primitive is kept exported for renderer, test, and
 * compatibility use, but it is not part of the recommended application
 * authoring surface.
 *
 * @internal
 */
export const createLoadingBoundary = (<T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
): Accessor<T | U> => (_createLoadingBoundary || coreLoadingBoundary)(fn, fallback, options)) as <
  T,
  U
>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
) => Accessor<T | U>;

function hydratedCreateLoadingBoundary<T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
): Accessor<T | U> {
  if (!sharedConfig.hydrating) return coreLoadingBoundary(fn, fallback, options);

  let settledSerializationResumeQueued = false;

  return coreMemo(() => {
    const o = getOwner()!;
    const id = o.id!;

    let assetPromise: Promise<void> | undefined;
    if (sharedConfig.hydrating && sharedConfig.has!(id + "_assets")) {
      const mapping = sharedConfig.load!(id + "_assets");
      if (mapping && typeof mapping === "object")
        assetPromise = sharedConfig.loadModuleAssets?.(mapping);
    }

    // Check boundary serialization key (sync SSR path: ctx.serialize(id, ...))
    if (sharedConfig.hydrating && sharedConfig.has!(id)) {
      const ref = sharedConfig.load!(id);
      let p: Promise<any> | any;
      if (ref) {
        if (typeof ref !== "object" || ref.s == null) p = ref;
        else if (ref.s === 1 || ref.s === 2) sharedConfig.gather?.(id);
        else p = ref;
      }
      if (
        ref &&
        typeof ref === "object" &&
        ref.s === 1 &&
        p == null &&
        !settledSerializationResumeQueued
      ) {
        if (assetPromise) {
          settledSerializationResumeQueued = true;
          const [, resume] = initBoundaryResume(o, id);
          scheduleResumeAfterAssets(id, resume, assetPromise);
          return undefined;
        }
        // Already settled: the server rendered content and it is in the DOM.
        // Hydrate straight through — the fallback only hydrates when it is
        // actually showing. Rendering it here would create phantom client DOM
        // and poison insert's node bookkeeping (#2801 bug 1).
        return coreLoadingBoundary(fn, fallback, options);
      }
      if (p) {
        const [set, resume, release] = initBoundaryResume(o, id);
        if (p !== "$$f") {
          waitAndResume(p, resume, assetPromise);
        } else {
          const afterAssets = () => {
            if (!release()) return;
            set();
            checkHydrationComplete();
          };
          if (assetPromise)
            // Server showed the fallback, so content is always fresh client
            // DOM; on preload failure proceed anyway and let lazy's own
            // import() retry/fail through normal channels.
            assetPromise.then(
              () => queueMicrotask(afterAssets),
              err => {
                reportAssetFailure(err);
                queueMicrotask(afterAssets);
              }
            );
          else queueMicrotask(afterAssets);
        }
        return fallback();
      }
    }

    // Check fragment registration key (streaming SSR path: registerFragment sets id + "_fr")
    if (
      sharedConfig.hydrating &&
      sharedConfig.has!(id + "_fr") &&
      !settledSerializationResumeQueued
    ) {
      const fr = sharedConfig.load!(id + "_fr");
      // A swap held for this boundary (arrived post-done, pre-claim) must
      // land before any branch below reads the DOM — the settled branches
      // all assume $df already ran.
      replayHeldFragment(id);

      if (fr && typeof fr === "object" && fr.s === 1 && !assetPromise && !fragmentSuperseded(id)) {
        // Fragment already settled and swapped in ($df ran before hydration):
        // the content is in the DOM, so hydrate straight through. The fallback
        // only hydrates when it is actually showing — rendering it here would
        // create phantom client DOM and poison insert's node bookkeeping
        // (#2801 bug 1).
        sharedConfig.gather?.(id);
        return coreLoadingBoundary(fn, fallback, options);
      }

      settledSerializationResumeQueued = true;
      const [, resume] = initBoundaryResume(o, id);

      if (fr && typeof fr === "object" && fr.s === 1 && fragmentSuperseded(id)) {
        // SUPERSEDED (#2801's inverse): the declaration settled but its markup
        // was retired before it shipped — an outer boundary settled first and
        // its fragment carries the final branch instead, so this placeholder
        // will never swap. The DOM shows this boundary's fallback: hydrate
        // that (it IS showing), then resume WITHOUT claiming — the children
        // must render as fresh client DOM off the settled records, because
        // there is no server-rendered content branch to adopt. Hydrating
        // straight through here claims keys the document never emitted (the
        // welcome/status mid-stream ticker miss).
        const resumeFresh = () => resume(false);
        if (assetPromise)
          assetPromise.then(
            () => queueMicrotask(resumeFresh),
            err => {
              reportAssetFailure(err);
              queueMicrotask(resumeFresh);
            }
          );
        else queueMicrotask(resumeFresh);
        return fallback();
      }

      if (fr && typeof fr === "object" && (fr.s === 1 || fr.s === 2)) {
        if (fr.s === 2) {
          // Rejected stream fragments swap to an empty template; any outer error fallback
          // has to be created as fresh client DOM, not claimed from server markup.
          // Nothing else consumes the settled-rejected `_fr` promise once this
          // branch takes over — swallow it so a rejected fragment (error
          // finalize or a client-hole handoff) doesn't surface as an
          // unhandled rejection.
          (fr as Promise<never>).catch?.(() => {});
          const resumeRejected = () => resume(false);
          if (assetPromise)
            assetPromise.then(
              () => queueMicrotask(resumeRejected),
              err => {
                reportAssetFailure(err);
                queueMicrotask(resumeRejected);
              }
            );
          else queueMicrotask(resumeRejected);
          return undefined;
        }
        scheduleResumeAfterAssets(id, resume, assetPromise);
        return undefined;
      }

      // The fragment is still streaming, and global hydration may already
      // read as "done" — this boundary can be rendering inside a deferred
      // claim scope (a frames slot fill, behind a lazy route module) that
      // runs after the root sync pass (#2964). Go on record as the
      // fragment's claimant so the reveal policy swaps the late content in
      // for this resume to claim instead of holding it; if the swap already
      // arrived and was held awaiting a claimant, replay it now.
      claimFragment(id);
      waitAndResume(fr, resume, assetPromise, false, fragmentAbort(id));
      return fallback();
    }

    if (assetPromise && !sharedConfig.has!(id)) {
      const [, resume] = initBoundaryResume(o, id);
      assetPromise.then(
        () => resume(),
        err => {
          reportAssetFailure(err);
          resume(false);
        }
      );
      return undefined;
    }
    return coreLoadingBoundary(fn, fallback, options);
  }) as unknown as Accessor<T | U>;
}

/**
 * Disables hydration for its children on the client.
 * During hydration, skips the subtree entirely (returns undefined so DOM is left untouched).
 * After hydration, renders children fresh.
 *
 * @example
 * ```tsx
 * // Mount a client-only widget that the server didn't render. The subtree
 * // is left empty during hydration, then renders fresh once hydration ends.
 * <NoHydration>
 *   <ClientOnlyMap />
 * </NoHydration>
 * ```
 */
export function NoHydration(props: { children: SolidElement }): SolidElement {
  const o = createOwner();
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, true);
    if (sharedConfig.hydrating) return undefined as unknown as SolidElement;
    return props.children;
  }) as unknown as SolidElement;
}

/**
 * Re-enables hydration within a `<NoHydration>` zone (passthrough on the
 * client). Use it to opt a subtree back into hydration when the surrounding
 * region was opted out.
 *
 * @example
 * ```tsx
 * // Inside a `<NoHydration>` region, re-enable hydration for one inner
 * // subtree that does need to match a server-rendered fragment.
 * <NoHydration>
 *   <ClientOnlyShell>
 *     <Hydration>
 *       <ServerHydratedWidget />
 *     </Hydration>
 *   </ClientOnlyShell>
 * </NoHydration>
 * ```
 */
export function Hydration(props: { id?: string; children: SolidElement }): SolidElement {
  return props.children as unknown as SolidElement;
}
