/**
 * Store — projections (plan sec. 31, S3; INTERNALS §7/§7b).
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
import { attrHooks } from "../core/attribution-hooks.js";
import {
  CONFIG_AUTO_DISPOSE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "../core/constants.js";
import { computed } from "../core/core.js";
import { NotReadyError } from "../core/error.js";
import {
  addPendingSource,
  forEachDependent,
  handleAsync,
  propagateStatus,
  settlePendingSource
} from "../core/async.js";
import { enqueueSub } from "../core/heap.js";
import { getOwner, isDisposed } from "../core/owner.js";
import { insertSubs, question, schedule, setQuestion } from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { Refreshable } from "../core/index.js";
import { optHooks } from "./hooks.js";
import { reconcileState } from "./reconcile.js";
import { nameStore, runDirect, storeSetter, wrap } from "./store.js";
import { setLookup, storeOwners, type StoreFamily, type StoreTarget } from "./target.js";
import {
  $TARGET,
  isWrappable,
  markRawIngest,
  setWriteOverride,
  type NoArray,
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
  afterWrite?: () => void,
  asking?: () => number
): any {
  const mutate = (op: () => void): true => {
    if (!isActive()) return true;
    setWriteOverride(true);
    // A continuation's write is the flight's answer: it asks the flight's
    // question (A18 provenance — a landing beneath a newer guess is held,
    // not a correction; lanes.ts `laneWrite`).
    const prevQ = question;
    if (asking !== undefined) setQuestion(asking());
    try {
      aroundWrite ? aroundWrite(op) : op();
    } finally {
      setWriteOverride(false);
      setQuestion(prevQ);
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
        ? wrapDraft(value, isActive, aroundWrite, false, afterWrite, asking)
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
  const px = new Proxy(Array.isArray(inner) ? [] : {}, traps);
  // The wrapper stands for its store proxy wherever the derive's result
  // carries it (`wrap`, `unwrapValue`, reconcile's slot matching).
  const t: StoreTarget | undefined = inner[$TARGET];
  if (t !== undefined) setLookup(px, t);
  return px;
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
function wakeFamily(fam: StoreFamily): void {
  const fw = fam.node!;
  // Pending on the derive itself, whatever source took it there (an upstream
  // memo's flight reaches it as a NotReady of that memo, #4271): the leaves
  // are not that source's dependents, so only the family's settle — which
  // retires the derive (`settleFamily`) — reaches the readers parked here. A
  // reader the landing leaves unchanged does not re-run to clear it (#4305).
  const error = new NotReadyError(fw);
  fam.woke = true;
  optHooks?.ask(fam);
  forEachFamilyNode(fam, n => {
    if (n._subs === null) return;
    // The leaf carries the derive's pending as a propagated copy, as a memo
    // between them would: a dependent recovering one branch stays pending
    // through a leaf it still reads (core `retryReaches`), and the landing's
    // walk retires the copy first (`settleFamily` → `settlePendingSource`).
    addPendingSource(n as unknown as Computed<any>, fw);
    // Its readers: core's propagation from the leaf — a verdict or re-derive
    // reader re-runs, any other is pending derivatively on the derive and
    // queued for the frame (held with it: the frame waits on the flight
    // through them, `blocked`).
    propagateStatus(n as unknown as Computed<any>, STATUS_PENDING, error);
  });
}

/** The derive's flight rejected: every live reader of the family
 * re-derives (its pull throws the derive's error). */
function errorFamily(fam: StoreFamily): void {
  forEachFamilyNode(fam, n => {
    if (n._subs === null) return;
    forEachDependent(n as unknown as Computed<any>, sub => {
      enqueueSub(sub);
    });
  });
  schedule();
}

/** The flight landed: the readers the wake left pending on the derive
 * settle — core's walk, from each leaf (the leaves are not the derive's
 * dependents, so its own settle walk does not reach them). */
function settleFamily(fam: StoreFamily): void {
  if (!fam.woke) return;
  fam.woke = false;
  const fw = fam.node!;
  forEachFamilyNode(fam, n => {
    if (n._subs !== null) settlePendingSource(n as unknown as Computed<any>, fw);
  });
  // The landing is the derive's change for a reader parked on the derive
  // itself, whatever status the landing pass began from (an errored derive
  // re-asked: a reader that met the error has no leaf to learn it from).
  insertSubs(fw);
}

/** A source's status reached the derive by propagation (core
 * `propagateStatus`), its pass not re-run: the family learns it as from the
 * pass's own throw. */
function familyStatus(this: StoreFamily, status: number): void {
  if (status & STATUS_PENDING) wakeFamily(this);
  else if (status & STATUS_ERROR) errorFamily(this);
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
  // The question a write of this run answers: inside a slice, the slice's
  // (the sync pass); in a continuation — the flight still registered — the
  // flight's (`handleAsync` stamped it with the action that asked).
  const asking = (): number =>
    question || (owner._x !== null && owner._x._inFlight !== null ? owner._x._q : 0);
  const draft = wrapDraft(
    wrappedStore,
    () => fam.run === run && !isDisposed(owner),
    aroundDraftWrite,
    target.s,
    // A write after the run returned (a continuation, a callback) arms the
    // drain itself when no landing will.
    () => {
      if (!(owner._statusFlags & STATUS_PENDING) && !owner._loading) schedule();
    },
    asking
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
        const commit = (v: void | T, wake: number = 1) => {
          // Shadow run: commit a detached snapshot, never the shadow itself
          // (adoption takes the value by identity — handing it the live
          // shadow would fuse the draft to the observable store).
          if (shadow && (v === undefined || v === (shadow as any)))
            v = cloneState(shadow, target.s);
          if (v !== (s as any) && v !== undefined) {
            const write = () => {
              const prevQ = question;
              setQuestion(asking());
              try {
                storeSetter(wrappedStore, st => reconcileState(v, st, key, true), false);
              } finally {
                setQuestion(prevQ);
              }
            };
            wrapCommit ? wrapCommit(write, v as T) : write();
          }
          // A landing (not the sync pass's own commit): the readers held
          // pending on the derive settle.
          if (!first || !(owner._statusFlags & STATUS_UNINITIALIZED)) settleFamily(fam);
          // A commit is the derive's change for the readers that observed its
          // flight (linked by `pullFamily`; a settled pull does not link), as
          // a memo's landing is for its readers: one that caught the NotReady
          // (a fallback value, not pending) re-runs too (#4070). A pass of a
          // settled derive has none (`wake` 0): a link left is a stale one a
          // held frame keeps (A30), from a reader that re-ran since. Woken by
          // every pass, a reader feeding a key the pass peeks at looped (#4342).
          if (wake) insertSubs(owner);
        };
        const sync = handleAsync(owner, result, commit, (error, pending) => {
          // The flight rejected: the leaves' readers learn it from here —
          // they do not subscribe to the derive. Pending again (a NotReady
          // rejection): the wake, as for the pass. Errored: every live
          // reader re-derives and meets the error at its pull (memo parity,
          // #2897) — and the flush that runs them advances the clock, so a
          // later tracked re-read may retry (core `read`).
          if (first && owner._statusFlags & STATUS_UNINITIALIZED) return;
          if (pending) wakeFamily(fam);
          else errorFamily(fam);
        });
        // (The status is the one before this pass: `recompute` sets it after.)
        if (!owner._loading)
          commit(sync as void | T, owner._statusFlags & (STATUS_PENDING | STATUS_ERROR));
      },
      false
    );
  try {
    first ? runDirect(pass) : pass();
  } catch (e) {
    // A flight went up (NotReady out of the pass — the derive's own, with
    // the derive as its source): the leaves' readers learn it from here —
    // they do not subscribe to the derive.
    // A synchronous error the same way (#3956: a rerun that finds the
    // entry failed throws): every live reader re-derives and meets it.
    if (!first) e instanceof NotReadyError ? wakeFamily(fam) : errorFamily(fam);
    throw e;
  }
  // A pass that returned with a flight up (an iterator's sync first yield):
  // the wake, as for the throw. Not a sync pass that superseded one — the
  // status it reads is the dead flight's, cleared when this pass settles
  // (#3181: a reader the settle walk had just released, re-parked for good).
  if (
    owner._statusFlags & STATUS_PENDING &&
    owner._x!._inFlight !== null &&
    !owner._loading &&
    !first
  )
    wakeFamily(fam);
  return owner;
}

/** A derived store's family and root (`opt`: an optimistic store's, its
 * derive `fn` optional — the plain form has none). */
export function createProjectionInternal<T extends object = {}>(
  fn: ((draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>) | null,
  seed: T | null | undefined,
  options?: ProjectionOptions,
  opt?: true
) {
  // Seedless (`fn` takes no draft): the root starts as an empty record. It is
  // a draft like any seed, never observable before the first landing (A25).
  seed ||= {} as T;
  const keyOption = options?.key === undefined ? "id" : options.key;
  const fam: StoreFamily = {
    map: new WeakMap(),
    node: null,
    live: new Set(),
    st: familyStatus,
    shallow: !!options?.shallow,
    opt,
    // The row key, for a child paired after the adoption (store.ts
    // `adoptChild`, #3712) as the adoption pairs them.
    key:
      typeof keyOption === "function"
        ? keyOption
        : keyOption === null
          ? null
          : (row: any) => (isWrappable(row) ? row[keyOption] : undefined)
  };
  const store = wrap(seed as any, null, null, fam) as Store<T>;
  if (fam.shallow) {
    ((store as any)[$TARGET] as StoreTarget).s = true;
    markRawIngest(seed);
  }
  let nodeOptions: { name?: string; loc?: string; loadingValue?: void } | undefined;
  if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
  if (__OBSERVE__ && attrHooks !== null)
    // As createStore: the owner in scope stamps the projection's property
    // nodes, so attribution places them under it (#4035).
    storeOwners!.set((store as any)[$TARGET] as StoreTarget, getOwner());
  if (__OBSERVE__ && (options?.name || options?.loc)) {
    nodeOptions = { ...nodeOptions, name: options.name, loc: options.loc };
    nameStore(store, options.name, options.loc);
  }
  if (fn) {
    const node = computed(() => {
      if (!fam.node) fam.node = getOwner() as Computed<any>;
      runProjectionComputed(store, fn, keyOption);
    }, nodeOptions);
    node._config &= ~CONFIG_AUTO_DISPOSE;
    fam.node = node;
    // The derive's leaves are not its dependents: a mark's repoll
    // (affects-marks.ts) and a source's status (core `propagateStatus`,
    // `familyStatus`) reach their readers through this.
    (node as any).fam = fam;
  }
  return store as Refreshable<Store<T>>;
}

/**
 * A derived store: `fn` runs in a computed and writes its draft; readers of
 * the store's keys re-run only when the keys they read change (the
 * firewall). `fn` may be async or an async iterator; the seed is a draft,
 * never an observable value, until the first landing (A25).
 */
export function createProjection<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null,
  options?: Omit<ProjectionOptions, "seedLoadingValue">
): Refreshable<Store<T>>;
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): Refreshable<Store<T>>;
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed?: T | null,
  options?: ProjectionOptions
): Refreshable<Store<T>> {
  return createProjectionInternal(fn, seed, options);
}

/** `createStore(fn, seed, options)`: a projection with a user setter. */
export function createStoreDerived<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: T | null | undefined,
  options?: ProjectionOptions
): [Refreshable<Store<T>>, (f: (draft: T) => T | void) => void] {
  const store = createProjectionInternal(fn, seed, options);
  return [store, (f: (draft: T) => T | void): void => storeSetter(store, f)];
}
