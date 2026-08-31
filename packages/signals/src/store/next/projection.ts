/**
 * Store rewrite — projections (§7/§7b): a projection is a computed store.
 * The derive runs inside a computed whose recompute merges its output into
 * the projection's backing through the adoption channel (replace-mode root:
 * entity changes merge in place, the root proxy is stable for life). Children
 * wrap into the projection's own FAMILY (writes land here, never in a source
 * family), and every family node carries the projection computed as its
 * firewall — reads link the derive's status and lifecycle natively. The §6c
 * status gate in the traps makes an uninitialized async derive's seed
 * unobservable through every read surface.
 *
 * Mirrors the legacy runProjectionComputed shape (shadow runs for open
 * loading windows, handleAsync landings, commit-through-setter) on next
 * primitives; the generic draft write-traps are reused from the legacy
 * module unchanged.
 */
import { ext } from "../../core/core.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  getOwner,
  handleAsync,
  suppressComputedRecompute,
  type Computed,
  type Refreshable
} from "../../core/index.js";

import { projectionWriteActive, setProjectionWriteActive } from "../../core/scheduler.js";
import {
  $TARGET,
  markRawIngest,
  setWriteOverride,
  STORE_VALUE,
  type NoFn,
  type ProjectionOptions,
  type Store
} from "../store.js";
import { reconcileNextState } from "./reconcile.js";
import { storeSetterNext, wrapNext } from "./store.js";
import type { StoreNextFamily } from "./target.js";

/**
 * Wrap a store proxy as a projection DRAFT: every operation carries the write
 * override (the derive is the author — its ops must not hit the §6c firewall
 * gate, even in a continuation after an `await`/`yield` where the sync write
 * scope has closed).
 *
 * FAKE TARGET, not the store proxy itself (#3060): after a proxy trap
 * returns, the engine runs spec invariant validation against the proxy's
 * TARGET — [[OwnPropertyKeys]] after ownKeys, [[GetOwnProperty]] after
 * set/getOwnPropertyDescriptor/defineProperty. With the store proxy as
 * target those checks re-enter the store's traps OUTSIDE the override
 * bracket (the trap's finally has already run), so `Object.keys(state)` in
 * a derive continuation fired the firewall gate and re-threw the
 * projection's own pending NotReadyError into the derive. A dummy of
 * matching kind (array/object, same trick as the store's own TargetShape)
 * keeps invariant validation away from the store entirely; the traps
 * forward to the closed-over inner proxy inside the bracket.
 *
 * Save/restore projectionWriteActive, never hard-reset: the draft can be
 * driven from inside an enclosing authoritative-write scope (next-store
 * optimistic derives), and a hard `false` would clobber it mid-derive.
 */
function wrapDraft(inner: any, isActive?: () => boolean, onDraftWrite?: () => void): any {
  const traps: ProxyHandler<any> = {
    get(_, prop) {
      let value;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = inner[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      if (prop === $TARGET) return value;
      return typeof value === "object" && value !== null
        ? wrapDraft(value, isActive, onDraftWrite)
        : value;
    },
    has(_, prop) {
      let value;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = prop in inner;
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return value;
    },
    set(_, prop, value) {
      if (isActive && !isActive()) return true;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        inner[prop] = value;
        onDraftWrite?.();
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    },
    deleteProperty(_, prop) {
      if (isActive && !isActive()) return true;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        delete inner[prop];
        onDraftWrite?.();
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    },
    ownKeys() {
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        return Reflect.ownKeys(inner);
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
    },
    getOwnPropertyDescriptor(_, prop) {
      let d;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        d = Reflect.getOwnPropertyDescriptor(inner, prop);
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      // The dummy target doesn't hold the key, so a non-configurable report
      // would violate the proxy invariant. Store descriptors are already
      // normalized configurable; enforce it for raw leaves too.
      if (d) d.configurable = true;
      return d;
    },
    defineProperty(_, prop, desc) {
      if (isActive && !isActive()) return true;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        Reflect.defineProperty(inner, prop, desc);
        onDraftWrite?.();
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    }
  };
  // Matching-kind dummy so Array.isArray(draft) answers like the store.
  return new Proxy(Array.isArray(inner) ? [] : {}, traps);
}

function createProjectionNextInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T>,
  options?: ProjectionOptions
) {
  const fam: StoreNextFamily = {
    map: new WeakMap(),
    node: null,
    shallow: !!(options as any)?.shallow
  };
  const store = wrapNext(seed as any, null, null, fam) as Store<T>;
  if (fam.shallow) {
    // Shallow projection: the root is the only wrapped level — slot values
    // serve raw, ingests sticky raw-mark (same t.s machinery as plain).
    ((store as any)[$TARGET] as any).s = true;
    markRawIngest(seed);
  }

  let nodeOptions: { name?: string; loadingValue?: void } | undefined;
  if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
  if (__DEV__ && options?.name) nodeOptions = { ...nodeOptions, name: options.name };
  const node = computed(() => {
    if (!fam.node) fam.node = getOwner() as Computed<any>;
    runProjectionComputedNext(store, fn, options?.key === undefined ? "id" : options.key);
  }, nodeOptions);
  node._config &= ~CONFIG_AUTO_DISPOSE;
  fam.node = node;

  return { store, node } as {
    store: Refreshable<Store<T>>;
    node: Computed<void | T>;
  };
}

export function createProjectionNext<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): Refreshable<Store<T>> {
  return createProjectionNextInternal(fn, seed, options).store;
}

/** Derived writable store (legacy parity): a projection whose public setter
 * masks the recompute for the tick (core R31 — the manual write wins over a
 * same-flush dependency change). */
export function createStoreDerivedNext<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [Refreshable<Store<T>>, (f: (draft: T) => T | void) => void] {
  const { store, node } = createProjectionNextInternal(fn, seed, options);
  return [
    store,
    (f: (draft: T) => T | void): void => {
      // Mark the projection as manually written before notifying nodes.
      suppressComputedRecompute(node as Computed<unknown>);
      storeSetterNext(store, f);
    }
  ];
}

export function runProjectionComputedNext<T extends object>(
  wrappedStore: Store<T>,
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  key: string | ((item: NonNullable<any>) => any) | null,
  wrapCommit?: (write: () => void, replacing?: boolean) => void,
  onDraftWrite?: (replacing?: boolean) => void
): Computed<void | T> {
  const owner = getOwner() as Computed<void | T>;
  let settled = false;
  // Flight gate (#3123 re-ruling): landings are REPLACING — the derive
  // re-answering its question from scratch (navigation, refresh, poll) —
  // until the invocation completes its FIRST answer: the first commit, or
  // the flight's own resolution (a void draft-mutator's answer is the
  // writes themselves; its resolution closes them). Landings after that —
  // later yields, post-answer draft writes on a live iterable flight — are
  // CONTINUATIONS of one living answer. The optimistic layer treats them
  // differently: replacement drops retained edits (#2719: a pending add
  // must not ghost onto the next dataset), continuation re-executes them.
  let landed = false;
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  // Open loading window (seedLoadingValue): the observable store IS commit #0
  // for the whole first flight — the derive works a detached shadow of the
  // seed so draft writes cannot tear through to readers (#2988). Every commit
  // point reconciles the shadow through the normal commit path.
  const shadow = owner._loading
    ? (JSON.parse(JSON.stringify((wrappedStore as any)[$TARGET][STORE_VALUE])) as T)
    : null;
  const draft = wrapDraft(
    wrappedStore,
    () => !settled || owner._x?._inFlight === result,
    onDraftWrite && (() => onDraftWrite(!landed))
  );
  storeSetterNext(
    draft,
    s => {
      result = fn((shadow ?? s) as T);
      settled = true;
      const commit = (v: void | T) => {
        // Shadow run: commit a detached snapshot, never the shadow itself
        // (adoption takes the value by identity — handing it the live shadow
        // would fuse the draft to the observable store).
        if (shadow && (v === undefined || v === (shadow as any)))
          v = JSON.parse(JSON.stringify(shadow)) as T;
        const replacing = !landed;
        // The answer is complete on ANY arrival here — a void/self return
        // included: it commits nothing, but it closes the flight's first
        // answer, so later draft writes on a live flight are continuations.
        landed = true;
        if (v === (s as any) || v === undefined) return;
        const write = () =>
          storeSetterNext(wrappedStore, st => reconcileNextState(v, st, key, true), false);
        wrapCommit ? wrapCommit(write, replacing) : write();
      };
      const sync = handleAsync(owner, result, commit);
      if (!owner._loading) commit(sync as void | T);
    },
    false
  );
  return owner;
}
