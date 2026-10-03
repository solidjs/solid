/**
 * Store — projections (plan §31, S3; INTERNALS §7/§7b).
 *
 * A projection is a computed store: the derive runs inside a computed — the
 * **firewall** — whose pass writes the store through a draft; its output is
 * adopted through the reconcile channel (replace-mode root: entity changes
 * merge in place, the root proxy is stable for life). Children wrap into
 * the projection's own FAMILY (writes land here, never in a source family).
 *
 * The firewall exists so writes from inside a computation are safe (the
 * derive owns its leaves); the price is the ordering obligation: before any
 * value is served through the projection, the derive is brought up to date
 * — **without** the reader subscribing to it (that is the propagation
 * barrier). The store's traps do that pull (`pullFamily`, store.ts): core's
 * `read()` of the firewall with no link — freshness, the status gate
 * (uninitialized / pending / errored) and the reader's height, by the
 * rules a memo's read follows. No per-leaf back-pointer, nothing in core.
 */
import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_REDERIVE,
  CONFIG_VERDICT,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "../core/constants.js";
import { computed } from "../core/core.js";
import { NotReadyError } from "../core/error.js";
import { forEachDependent, handleAsync, notifyStatus, settlePendingSource } from "../core/async.js";
import { enqueueSub } from "../core/heap.js";
import { getOwner, isDisposed } from "../core/owner.js";
import { schedule } from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { Refreshable } from "../core/index.js";
import { reconcileState } from "./reconcile.js";
import { nameStore, runDirect, storeSetter, wrap } from "./store.js";
import type { StoreFamily, StoreTarget } from "./target.js";
import {
  $TARGET,
  markRawIngest,
  setWriteOverride,
  type NoFn,
  type ProjectionOptions,
  type Store
} from "./types.js";

/**
 * Wrap a store proxy as a projection DRAFT: every operation carries the write
 * override (the derive is the author — its ops must not hit the status gate,
 * even in a continuation after an `await`/`yield` where the sync write scope
 * has closed).
 *
 * FAKE TARGET, not the store proxy itself (#3060): after a proxy trap
 * returns, the engine runs spec invariant validation against the proxy's
 * TARGET — [[OwnPropertyKeys]] after ownKeys, [[GetOwnProperty]] after
 * set/getOwnPropertyDescriptor/defineProperty. With the store proxy as
 * target those checks re-enter the store's traps OUTSIDE the override
 * bracket, so `Object.keys(state)` in a derive continuation fired the gate.
 */
function wrapDraft(
  inner: any,
  isActive: () => boolean,
  aroundWrite?: (op: () => void) => void,
  shallow?: boolean,
  afterWrite?: () => void
): any {
  const mutate = (op: () => void): true => {
    if (!isActive()) return true;
    setWriteOverride(true);
    try {
      aroundWrite ? aroundWrite(op) : op();
    } finally {
      setWriteOverride(false);
    }
    if (afterWrite) afterWrite();
    return true;
  };
  const read = <T>(op: () => T): T => {
    setWriteOverride(true);
    try {
      return op();
    } finally {
      setWriteOverride(false);
    }
  };
  const traps: ProxyHandler<any> = {
    get(_, prop) {
      const value = read(() => inner[prop]);
      return !shallow && typeof value === "object" && value !== null && prop !== $TARGET
        ? wrapDraft(value, isActive, aroundWrite, false, afterWrite)
        : value;
    },
    has: (_, prop) => read(() => prop in inner),
    set: (_, prop, value) =>
      mutate(() => {
        inner[prop] = value;
      }),
    deleteProperty: (_, prop) =>
      mutate(() => {
        delete inner[prop];
      }),
    ownKeys: () => read(() => Reflect.ownKeys(inner)),
    getOwnPropertyDescriptor(_, prop) {
      const d = read(() => Reflect.getOwnPropertyDescriptor(inner, prop));
      if (d) d.configurable = true;
      return d;
    },
    defineProperty: (_, prop, desc) =>
      mutate(() => {
        Reflect.defineProperty(inner, prop, desc);
      })
  };
  return new Proxy(Array.isArray(inner) ? [] : {}, traps);
}

function cloneState<T extends object>(v: T, shallow: boolean): T {
  return shallow ? (Array.isArray(v) ? (v.slice() as T) : { ...v }) : JSON.parse(JSON.stringify(v));
}

/** The derive's pass went pending (a new question in flight): every reader
 * of a leaf learns it as a reader of the derive would (A9: any leaf reports
 * the firewall's refetch) — core's own rule for a dependency going pending
 * (`notifyStatus`): a verdict or re-derive reader re-runs, any other is
 * pending derivatively on the derive (its readers hold; it re-runs at the
 * landing). The leaves do not subscribe to the derive, so the family does
 * the walk. */
function wakeFamily(fam: StoreFamily, error: unknown): void {
  forEachFamilyNode(fam, n => {
    if (n._subs === null) return;
    forEachDependent(n as unknown as Computed<any>, sub => {
      if (sub._config & (CONFIG_REDERIVE | CONFIG_VERDICT)) {
        enqueueSub(sub);
        schedule();
      } else if (!(sub._statusFlags & STATUS_PENDING)) notifyStatus(sub, STATUS_PENDING, error);
    });
  });
}

/** The flight landed: the readers the wake left pending on the derive
 * settle — core's walk, from each leaf (the leaves are not the derive's
 * dependents, so its own settle walk does not reach them). */
function settleFamily(fam: StoreFamily): void {
  const fw = fam.node!;
  forEachFamilyNode(fam, n => {
    if (n._subs !== null) settlePendingSource(n as unknown as Computed<any>, fw);
  });
}

function forEachFamilyNode(fam: StoreFamily, fn: (n: Signal<any>) => void): void {
  for (const t of fam.live) {
    const nodes = t.n;
    if (nodes !== null) for (const key of Reflect.ownKeys(nodes)) fn(nodes[key as any]);
    const has = t.h;
    if (has !== null) for (const key of Reflect.ownKeys(has)) fn(has[key as any]);
    if (t.k !== null) fn(t.k);
    if (t.dk !== null) fn(t.dk);
  }
}

/** The derive's pass: run `fn` against a draft of the store; commit its
 * result (sync, or each async landing) through the reconcile channel.
 * Draft validity is per run (R37): live from here until the NEXT run starts
 * — a sync derive that subscribes to an external source and pushes into
 * the draft from the callback (#3585) is the model use. */
export function runProjectionComputed<T extends object>(
  wrappedStore: Store<T>,
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  key: string | ((item: NonNullable<any>) => any) | null,
  wrapCommit?: (write: () => void, value: T) => void,
  aroundDraftWrite?: (op: () => void) => void
): Computed<void | T> {
  const owner = getOwner() as Computed<void | T>;
  const target: StoreTarget = (wrappedStore as any)[$TARGET];
  const fam = target.fam!;
  const run = (fam.run = (fam.run || 0) + 1);
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  // Open loading window (seedLoadingValue): the observable store IS commit #0
  // for the whole first flight — the derive works a detached shadow of the
  // seed so draft writes cannot tear through to readers (#2988). Every
  // commit point reconciles the shadow through the normal commit path.
  const shadow = owner._loading ? cloneState(target.v as T, target.s) : null;
  const draft = wrapDraft(
    wrappedStore,
    () => fam.run === run && !isDisposed(owner),
    aroundDraftWrite,
    target.s,
    // A write after the run returned (a continuation, a callback) arms the
    // drain itself when no landing will.
    () => {
      if (!(owner._statusFlags & STATUS_PENDING) && !owner._loading) schedule();
    }
  );
  // The creation run commits directly (a memo's first value is its
  // `_value`); every later run — a re-derive in a flush, an async landing
  // — stages and commits with the flush like a memo's recompute.
  const first = run === 1;
  const pass = () =>
    storeSetter(
      draft,
      s => {
        result = fn((shadow ?? s) as T);
        const commit = (v: void | T) => {
          // Shadow run: commit a detached snapshot, never the shadow itself
          // (adoption takes the value by identity — handing it the live
          // shadow would fuse the draft to the observable store).
          if (shadow && (v === undefined || v === (shadow as any)))
            v = cloneState(shadow, target.s);
          if (v !== (s as any) && v !== undefined) {
            const write = () =>
              storeSetter(wrappedStore, st => reconcileState(v, st, key, true), false);
            wrapCommit ? wrapCommit(write, v as T) : write();
          }
          // A landing (not the sync pass's own commit): the readers held
          // pending on the derive settle.
          if (!first || !(owner._statusFlags & STATUS_UNINITIALIZED)) settleFamily(fam);
        };
        const sync = handleAsync(owner, result, commit);
        if (!owner._loading) commit(sync as void | T);
      },
      false
    );
  try {
    first ? runDirect(pass) : pass();
  } catch (e) {
    // A flight went up (NotReady out of the pass — the derive's own, with
    // the derive as its source): the leaves' readers learn it from here —
    // they do not subscribe to the derive.
    if (e instanceof NotReadyError && !first) wakeFamily(fam, e);
    throw e;
  }
  if (owner._statusFlags & STATUS_PENDING && !owner._loading && !first)
    wakeFamily(fam, owner._x?._error);
  return owner;
}

function createProjectionInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T>,
  options?: ProjectionOptions
) {
  const fam: StoreFamily = {
    map: new WeakMap(),
    node: null,
    live: new Set(),
    shallow: !!options?.shallow
  };
  const store = wrap(seed as any, null, null, fam) as Store<T>;
  if (fam.shallow) {
    ((store as any)[$TARGET] as StoreTarget).s = true;
    markRawIngest(seed);
  }
  let nodeOptions: { name?: string; loadingValue?: void } | undefined;
  if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
  if (__OBSERVE__ && options?.name) {
    nodeOptions = { ...nodeOptions, name: options.name };
    nameStore(store, options.name);
  }
  const node = computed(() => {
    if (!fam.node) fam.node = getOwner() as Computed<any>;
    runProjectionComputed(store, fn, options?.key === undefined ? "id" : options.key);
  }, nodeOptions);
  node._config &= ~CONFIG_AUTO_DISPOSE;
  fam.node = node;
  return { store, node } as { store: Refreshable<Store<T>>; node: Computed<void | T> };
}

/**
 * A derived store: `fn` runs in a computed and writes its draft; readers of
 * the store's keys re-run only when the keys they read change (the
 * firewall). `fn` may be async or an async iterator; the seed is a draft,
 * never an observable value, until the first landing (A25).
 */
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): Refreshable<Store<T>> {
  return createProjectionInternal(fn, seed, options).store;
}

/** `createStore(fn, seed, options)`: a projection with a user setter. */
export function createStoreDerived<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [Refreshable<Store<T>>, (f: (draft: T) => T | void) => void] {
  const { store } = createProjectionInternal(fn, seed, options);
  return [store, (f: (draft: T) => T | void): void => storeSetter(store, f)];
}
