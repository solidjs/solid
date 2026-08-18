/**
 * Store rewrite — optimistic stores (§3/§7, RUL-3): no store-side layer, no
 * backup snapshots. Nodes in an optimistic family are ARMED core signals
 * (`_overrideValue` slot), so every user write rides the engine's
 * optimisticWrite — per-transaction ownership, entanglement, reverts, and
 * flash-at-flush are inherited, not reimplemented. Membership edits live on
 * armed presence nodes (the §6 overlay), so structural optimism reverts with
 * the same per-transaction granularity (FINDING-2's fix by construction).
 *
 * Derived form = an optimistic projection: the derive's recompute and its
 * async commits run under projectionWriteActive (authoritative landings
 * commit silently beneath any active overrides). The transitionBlocked
 * store-half (#2951) is installed here for next-shaped targets, chaining the
 * legacy/engine checks.
 */
import { NOT_PENDING, STATUS_PENDING } from "../../core/constants.js";
import { computed, CONFIG_AUTO_DISPOSE, type Computed } from "../../core/index.js";
import { GlobalQueue } from "../../core/scheduler.js";
import { installOptimisticStoreHooks } from "../optimistic.js";
import {
  $TARGET,
  type NoFn,
  type ProjectionOptions,
  type Store,
  type StoreSetter
} from "../store.js";
import { runProjectionComputedNext } from "./projection.js";
import { consumeOverridesNext, runAuthoritative, storeSetterNext, wrapNext } from "./store.js";
import type { StoreNextFamily, StoreNextTarget } from "./target.js";

let blockedInstalled = false;
function installNextBlockedHalf(): void {
  if (blockedInstalled) return;
  blockedInstalled = true;
  const chained = GlobalQueue._transitionBlocked!;
  GlobalQueue._transitionBlocked = transition => {
    for (const store of transition._optimisticStores) {
      const t = (store as any)?.[$TARGET] as StoreNextTarget | undefined;
      const fw: any = t?.fam?.node;
      // The hold exists to keep optimistic state alive until the store's own
      // truth lands (#2951). Once the family carries NO live overrides (a
      // landing consumed them, or they never existed), a pending firewall is
      // no reason to park the transaction — blocking then leaks it forever
      // when the in-flight question is never answered (undisposed fixtures).
      if (fw != null && fw._statusFlags & STATUS_PENDING && familyHasLiveOverrides(t!.fam!))
        return true;
    }
    return chained(transition);
  };
}

function familyHasLiveOverrides(fam: { overlaid?: Set<any> }): boolean {
  const overlaid = fam.overlaid;
  if (overlaid === undefined || overlaid.size === 0) return false;
  for (const t of overlaid as Set<StoreNextTarget>) {
    for (const bucket of [t.n, t.h] as const) {
      if (bucket === null) continue;
      for (const key of Reflect.ownKeys(bucket)) {
        const node: any = bucket[key as any];
        if (node._overrideValue !== undefined && node._overrideValue !== NOT_PENDING) return true;
      }
    }
    if (t.k !== null && t.k._overrideValue !== undefined && t.k._overrideValue !== NOT_PENDING)
      return true;
  }
  overlaid.clear(); // nothing live — drop the bookkeeping
  return false;
}

export function createOptimisticStoreNext<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  // Engine + legacy store hooks first (armed nodes need optimisticWrite
  // installed before any node exists), then the next-shape blocked half.
  installOptimisticStoreHooks();
  installNextBlockedHalf();

  const derived = typeof first === "function";
  if (!derived && options === undefined) options = second as ProjectionOptions | undefined;
  const initialValue = (derived ? second : first) as T;

  const fam: StoreNextFamily = { map: new WeakMap(), node: null, shallow: false, opt: true };
  const store = wrapNext(initialValue as any, null, null, fam) as Store<T>;
  fam.px = store;

  if (derived) {
    const fn = first as (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>;
    // Async commits land outside the computed's sync body — re-apply the
    // authoritative-write posture there too. Landings consume the family's
    // tentative overrides (RUL-2: visible landed truth replaces optimism) —
    // both the reconcile-channel commit and per-op post-await draft writes.
    const consume = () => consumeOverridesNext(fam);
    const wrapCommit = (write: () => void) => {
      runAuthoritative(write);
      consume();
    };
    let nodeOptions: { name?: string; loadingValue?: void } | undefined;
    if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
    if (__DEV__ && options?.name) nodeOptions = { ...nodeOptions, name: options.name };
    const node = computed(
      () =>
        runAuthoritative(() =>
          runProjectionComputedNext(
            store,
            fn,
            options?.key === undefined ? "id" : options.key,
            wrapCommit,
            consume
          )
        ),
      nodeOptions
    ) as Computed<void>;
    node._config &= ~CONFIG_AUTO_DISPOSE;
    fam.node = node;
  }

  return [store, ((fn: (draft: T) => void) => storeSetterNext(store, fn)) as StoreSetter<T>];
}
