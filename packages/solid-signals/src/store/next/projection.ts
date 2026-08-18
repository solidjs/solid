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
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  getOwner,
  handleAsync,
  type Computed,
  type Refreshable
} from "../../core/index.js";
import { createWriteTraps } from "../projection.js";
import { $TARGET, STORE_VALUE, type NoFn, type ProjectionOptions, type Store } from "../store.js";
import { reconcileNextState } from "./reconcile.js";
import { storeSetterNext, wrapNext } from "./store.js";
import type { StoreNextFamily } from "./target.js";

export function createProjectionNextInternal<T extends object = {}>(
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

export function runProjectionComputedNext<T extends object>(
  wrappedStore: Store<T>,
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  key: string | ((item: NonNullable<any>) => any) | null,
  wrapCommit?: (write: () => void) => void,
  onDraftWrite?: () => void
): Computed<void | T> {
  const owner = getOwner() as Computed<void | T>;
  let settled = false;
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  // Open loading window (seedLoadingValue): the observable store IS commit #0
  // for the whole first flight — the derive works a detached shadow of the
  // seed so draft writes cannot tear through to readers (#2988). Every commit
  // point reconciles the shadow through the normal commit path.
  const shadow = owner._loading
    ? (JSON.parse(JSON.stringify((wrappedStore as any)[$TARGET][STORE_VALUE])) as T)
    : null;
  const draft = new Proxy(
    wrappedStore,
    createWriteTraps(() => !settled || owner._inFlight === result, onDraftWrite)
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
        if (v === (s as any) || v === undefined) return;
        const write = () =>
          storeSetterNext(wrappedStore, st => reconcileNextState(v, st, key, true), false);
        wrapCommit ? wrapCommit(write) : write();
      };
      const sync = handleAsync(owner, result, commit);
      if (!owner._loading) commit(sync as void | T);
    },
    false
  );
  return owner;
}
