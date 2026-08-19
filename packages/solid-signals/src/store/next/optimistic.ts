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
import { NOT_PENDING, STATUS_PENDING, unwrapOverride } from "../../core/constants.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  isEqual,
  setSignal,
  type Computed,
  type Signal
} from "../../core/index.js";
import { GlobalQueue, globalQueue, insertSubs, schedule } from "../../core/scheduler.js";
import { installOptimisticEngine } from "../../core/optimistic.js";
import {
  $TARGET,
  markRawIngest,
  type NoFn,
  type ProjectionOptions,
  type Store,
  type StoreSetter
} from "../store.js";
import { runProjectionComputedNext } from "./projection.js";
import {
  getHasNode,
  getKeySetNode,
  getNode,
  hasActiveOverride,
  runAuthoritative,
  storeSetterNext,
  targetsEqual,
  unwrapValue,
  wrapNext
} from "./store.js";
import { setOptHooks, storeNextLookup } from "./target.js";
type KeyFn = (item: any) => any;
import { isRawValue, isWrappable, rawValuesUsed, setNextOptimisticViewResolver } from "../store.js";
import type { StoreNextFamily, StoreNextTarget } from "./target.js";

let blockedInstalled = false;
function installNextBlockedHalf(): void {
  if (blockedInstalled) return;
  blockedInstalled = true;
  // Late-bind the optimistic machinery into the plain store/reconcile paths
  // (all call sites are fam?.opt-gated, so this always runs first) and the
  // affects witness's view resolver.
  setOptHooks({ notifyOptimisticWrites, optimisticView, applyTentative });
  setNextOptimisticViewResolver((t: StoreNextTarget, raw: any) => optimisticView(t, raw));
  // Scheduler flush tails call _clearOptimisticStores whenever tracked
  // stores exist; next has no layer to clear — reverts are engine-native —
  // so the hook only empties the batch set.
  if (!GlobalQueue._clearOptimisticStores) {
    GlobalQueue._clearOptimisticStores = (stores: Set<any>) => {
      stores.clear();
    };
  }
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
  // Engine first (armed nodes need optimisticWrite installed before any
  // node exists), then the next-shape hooks.
  installOptimisticEngine();
  installNextBlockedHalf();

  const derived = typeof first === "function";
  if (!derived && options === undefined) options = second as ProjectionOptions | undefined;
  const initialValue = (derived ? second : first) as T;

  const fam: StoreNextFamily = {
    map: new WeakMap(),
    node: null,
    shallow: !!(options as any)?.shallow,
    opt: true
  };
  const store = wrapNext(initialValue as any, null, null, fam) as Store<T>;
  fam.px = store;
  if (fam.shallow) {
    ((store as any)[$TARGET] as StoreNextTarget as any).s = true;
    markRawIngest(initialValue);
  }

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
    const node = computed(() => {
      runAuthoritative(() =>
        runProjectionComputedNext(
          store,
          fn,
          options?.key === undefined ? "id" : options.key,
          wrapCommit,
          consume
        )
      );
    }, nodeOptions) as Computed<void>;
    node._config &= ~CONFIG_AUTO_DISPOSE;
    fam.node = node;
  }

  return [store, ((fn: (draft: T) => void) => storeSetterNext(store, fn)) as StoreSetter<T>];
}

// ---- optimistic-only store machinery (moved from next/store.ts /
// next/reconcile.ts so plain-store bundles tree-shake it) ----

/** Diff the draft against the current OPTIMISTIC VIEW (committed + active
 * overrides — the same view the draft was seeded from) and emit engine writes
 * for exactly the changed keys. Visible-view diffing keeps no-op writes from
 * entangling lanes (RUL-10 / opt R38). */
export function notifyOptimisticWrites(t: StoreNextTarget, pb: Record<PropertyKey, any>): void {
  // A bare write while the store's own truth is in flight rides THAT
  // transaction (#2951, legacy parity): entangle the firewall's transition so
  // the override survives until the refetch settles instead of flash-reverting
  // at plain flush end. The blocked-check store-half keeps that transaction
  // from settling while the firewall is pending.
  const fw: any = t.fam?.node;
  if (fw?._transition) globalQueue.initTransition(fw._transition);
  const old = t.v;
  const visible = (key: PropertyKey, fallback: any): any => {
    const node = t.n?.[key as any];
    return node !== undefined && hasActiveOverride(node)
      ? unwrapOverride(node._overrideValue)
      : fallback;
  };
  const visiblePresent = (key: PropertyKey): boolean => {
    const node = t.h?.[key as any];
    return node !== undefined && hasActiveOverride(node)
      ? !!unwrapOverride(node._overrideValue)
      : key in old;
  };
  let structural = false;
  const isArr = Array.isArray(pb);
  for (const key of Reflect.ownKeys(pb)) {
    if (isArr && key === "length") continue;
    const nv = unwrapValue(pb[key as any]);
    if (!visiblePresent(key)) {
      // Optimistic add: value node + presence node + membership bump.
      setSignal(getNode(t, key, old[key as any]), () => nv);
      setSignal(getHasNode(t, key, key in old), true as any);
      structural = true;
    } else {
      const ov = visible(key, old[key as any]);
      if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) {
        setSignal(getNode(t, key, ov), () => nv);
        if (isArr) structural = true;
      }
    }
  }
  for (const key of Reflect.ownKeys(old)) {
    if (isArr && key === "length") continue;
    if (key in pb || !visiblePresent(key)) continue;
    // Optimistic delete: node reads undefined, presence flips, membership bumps.
    setSignal(getNode(t, key, old[key as any]), () => undefined);
    setSignal(getHasNode(t, key, true), false as any);
    structural = true;
  }
  if (isArr) {
    const oldLen = visible("length", (old as any[]).length);
    if (oldLen !== (pb as any[]).length) {
      setSignal(getNode(t, "length", oldLen), () => (pb as any[]).length);
      structural = true;
    }
  }
  if (structural) setSignal(getKeySetNode(t), v => v + 1);
  // Discard the draft — committed raw is untouched (revert target by
  // construction). Register the root store for the scheduler's settle hooks
  // and the target for landing consumption (RUL-2).
  t.pb = null;
  (t.fam!.overlaid ??= new Set()).add(t);
  GlobalQueue._trackOptimisticStore?.(t.fam!.px ?? t.px);
}

/**
 * Landing consumption (RUL-2): fresh authoritative data supersedes every
 * tentative override in the family. Mirrors legacy clearProjectionOverride —
 * drop the override, clear lane/ownership, notify subscribers whose visible
 * value changes (reversion effects go to regular queues via the projection
 * write posture the caller holds).
 */
export function consumeOverridesNext(fam: StoreNextFamily): void {
  const overlaid = fam.overlaid;
  if (overlaid === undefined || overlaid.size === 0) return;
  runAuthoritative(() => {
    for (const t of overlaid as Set<StoreNextTarget>) {
      const drop = (node: Signal<any>, committed: any) => {
        if (!hasActiveOverride(node)) return;
        const prev = unwrapOverride(node._overrideValue);
        // Full legacy reset (clearOptimisticOverride parity): the landing is
        // authoritative NOW — fold committed into the node directly instead
        // of riding a transaction's commit (whose queues may be stashed with
        // the transaction parked; the wake would strand until it settles).
        node._overrideValue = NOT_PENDING;
        (node as any)._overrideOwner = null;
        (node as any)._optimisticLane = undefined;
        node._pendingValue = NOT_PENDING;
        node._value = committed;
        if (!node._equals || !node._equals(prev, committed)) {
          insertSubs(node, true);
          schedule();
        }
      };
      // Landing consumes STRUCTURAL optimism only (legacy layer parity):
      // membership edits, array length, and the value overrides written WITH
      // them (a key carrying an active presence override is an add/delete —
      // classified BEFORE the adoption may have made the key exist in landed
      // data). A pure value override on a key the landing carries stays with
      // its owning transaction (rapid-toggle contract: a live action's edit
      // of an existing entity rides on top of landed truth).
      const isArr = Array.isArray(t.v);
      const has = t.h;
      let structuralKeys: Set<PropertyKey> | null = null;
      if (has !== null) {
        for (const key of Reflect.ownKeys(has)) {
          if (hasActiveOverride(has[key as any])) (structuralKeys ??= new Set()).add(key);
        }
      }
      const nodes = t.n;
      if (nodes !== null) {
        for (const key of Reflect.ownKeys(nodes)) {
          const structural =
            structuralKeys?.has(key) || !(key in t.v) || (isArr && key === "length");
          if (!structural) continue;
          drop(
            nodes[key as any],
            isArr && key === "length" ? (t.v as any[]).length : t.v[key as any]
          );
        }
      }
      if (has !== null) {
        for (const key of Reflect.ownKeys(has)) drop(has[key as any], key in t.v);
      }
      if (t.k !== null && hasActiveOverride(t.k)) {
        t.k._overrideValue = NOT_PENDING;
        (t.k as any)._overrideOwner = null;
        (t.k as any)._optimisticLane = undefined;
        insertSubs(t.k, true);
        schedule();
      }
    }
    overlaid.clear();
  });
}

/** Optimistic-view composition for snapshot/deep (O1: snapshot is the CURRENT
 * view, lane values included; a fresh copy per call during pending windows —
 * RUL-12). Returns `src` untouched when no override is active on `t`. */
export function optimisticView(
  t: StoreNextTarget,
  src: Record<PropertyKey, any>
): Record<PropertyKey, any> {
  if (t.fam?.opt !== true) return src;
  let out: Record<PropertyKey, any> | null = null;
  const ensure = () => (out ??= Array.isArray(src) ? [...(src as any[])] : { ...src });
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) {
      const node = nodes[key as any];
      if (!hasActiveOverride(node)) continue;
      const ov = unwrapOverride(node._overrideValue);
      if (key === "length" && Array.isArray(src)) {
        if ((src as any[]).length !== ov) (ensure() as any[]).length = ov;
      } else if (!isEqual(src[key as any], ov)) ensure()[key as any] = ov;
    }
  }
  const has = t.h;
  if (has !== null) {
    for (const key of Reflect.ownKeys(has)) {
      const node = has[key as any];
      if (!hasActiveOverride(node)) continue;
      const present = !!unwrapOverride(node._overrideValue);
      if (!present && key in (out ?? src)) delete ensure()[key as any];
    }
  }
  return out ?? src;
}

function applyTentative(t: StoreNextTarget, incoming: any, keyFn: KeyFn | null): void {
  const base = t.pb ?? t.v;
  const view = optimisticView(t, base);
  const map = t.fam!.map;
  const isArr = Array.isArray(incoming);
  if (Array.isArray(view) !== isArr) return; // kind change at root: flat overrides below
  const pairs: Array<[StoreNextTarget, any]> = [];
  const pbLike: any = isArr ? [...(incoming as any[])] : shallowWithSymbols(incoming);
  const match = (pv: any, nv: any): StoreNextTarget | null => {
    if (!isWrappable(pv) || !isWrappable(nv)) return null;
    if (rawValuesUsed && (isRawValue(pv) || isRawValue(nv))) return null;
    if (Array.isArray(pv) !== Array.isArray(nv)) return null;
    if (keyFn) {
      const pk = keyFn(pv);
      const nk = keyFn(nv);
      if (pk !== undefined && nk !== undefined && pk !== nk) return null;
    }
    return map.get(unwrapValue(pv)) ?? null;
  };
  if (isArr) {
    const viewRows = view as any[];
    let viewByKey: Map<any, any> | null = null;
    for (let i = 0; i < (incoming as any[]).length; i++) {
      const nv = (incoming as any[])[i];
      if (!isWrappable(nv)) continue;
      let pv: any;
      if (keyFn) {
        const nk = keyFn(nv);
        if (nk !== undefined) {
          if (viewByKey === null) {
            viewByKey = new Map();
            for (let j = 0; j < viewRows.length; j++) {
              const p = unwrapValue(viewRows[j]);
              if (isWrappable(p)) {
                const pk = keyFn(p);
                if (pk !== undefined && !viewByKey.has(pk)) viewByKey.set(pk, p);
              }
            }
          }
          pv = viewByKey.get(nk);
        } else pv = unwrapValue(viewRows[i]);
      } else pv = unwrapValue(viewRows[i]);
      const ct = match(pv, nv);
      if (ct !== null) {
        // Keep the existing row in the slot (identity preserved); recurse.
        pbLike[i] = unwrapValue(pv);
        pairs.push([ct, nv]);
      }
    }
  } else {
    for (const k of Reflect.ownKeys(incoming)) {
      const pv = unwrapValue((view as any)[k]);
      const nv = (incoming as any)[k];
      const ct = match(pv, nv);
      if (ct !== null) {
        pbLike[k] = pv;
        pairs.push([ct, nv]);
      }
    }
  }
  // Flat overrides for this level (adds, removals, moved slots, length, leaf
  // values) — preserve any live user draft backing across the call.
  const priorPB = t.pb;
  t.pb = null;
  notifyOptimisticWrites(t, pbLike);
  t.pb = priorPB;
  for (let i = 0; i < pairs.length; i++)
    applyTentative(pairs[i][0], unwrapValue(pairs[i][1]), keyFn);
}

function shallowWithSymbols(src: any): any {
  const out: any = {};
  for (const k of Reflect.ownKeys(src)) out[k] = src[k];
  return out;
}
