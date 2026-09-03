/**
 * Store rewrite — optimistic stores (§3/§7, RUL-3): no store-side layer, no
 * backup snapshots. Nodes in an optimistic family are ARMED core signals
 * (`_overrideValue` slot), so every user write rides the engine's
 * optimisticWrite — per-transaction ownership, entanglement, reverts, and
 * flash-at-flush are inherited, not reimplemented. Membership edits live on
 * armed presence nodes (the §6 overlay), so structural optimism reverts with
 * the same per-transaction granularity (FINDING-2's fix by construction).
 *
 * Derived form = an optimistic projection. Landings follow the fold rule
 * (#3164, RUL-2 as re-ruled): while a transaction retains optimistic edits
 * on the family, truth that lands STAGES into that transaction — a keyed
 * identity-preserving walk written through the ordinary staged setter
 * channel — and reveals atomically at settle, exactly like a signal landing
 * under an active override (asyncWrite's held branch). Optimistic edits are
 * never consumed by landings; they live exactly as long as their transaction
 * and die by engine-native revert. With no retainer, landings commit
 * immediately under projectionWriteActive (authoritative, silently beneath
 * any bare-write overrides — those ride the flight's own transition, #2951).
 * Authoritative readers (until()'s predicate) tunnel into staged truth via
 * the node read path's pending-value arm. The transitionBlocked store-half
 * (#2951) is installed here for next-shaped targets, chaining the
 * legacy/engine checks.
 */
import {
  CONFIG_HELD_TRUTH,
  CONFIG_OPTIMISTIC,
  NOT_PENDING,
  STATUS_PENDING,
  unwrapOverride
} from "../../core/constants.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  getOwner,
  isEqual,
  setSignal,
  type Computed,
  type Signal
} from "../../core/index.js";
import {
  GlobalQueue,
  globalQueue,
  activeTransition,
  createTransition,
  currentTransition,
  runAsTransitionBatch,
  type Transition
} from "../../core/scheduler.js";
import { beginAsyncReporterWrites, endAsyncReporterWrites } from "../../core/invariants.js";
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
  bumpDeep,
  authoritativeRead,
  getHasNode,
  getKeySetNode,
  getNode,
  hasActiveOverride,
  runAuthoritative,
  stagedTruthPB,
  storeSetterNext,
  targetsEqual,
  unwrapValue,
  wrapNext
} from "./store.js";
// Cycle with reconcile.js is benign: the binding resolves at call time (the
// optimistic write), long after both modules initialize.
import { sameKey } from "./reconcile.js";
import { setOptHooks, storeNextLookup } from "./target.js";
type KeyFn = (item: any) => any;
import { isRawValue, isWrappable, rawValuesUsed, setNextOptimisticViewResolver } from "../store.js";
import type { StoreNextFamily, StoreNextTarget } from "./target.js";

/** #3164 fold: a stamped truth is HELD (masked from ordinary readers until
 * the reveal) only while its transition is live AND retaining optimism —
 * overrides are what make partial-coverage composition a tear. A plain
 * async transition carries no overrides, so downstream computes must see
 * staged values to converge (normal speculation). Resolves merges first:
 * merge unions optimistic nodes/stores into the target. */
export function transitionHoldsOptimism(transition: Transition): boolean {
  const t = currentTransition(transition);
  return t._done !== true && (t._optimisticNodes.length !== 0 || t._optimisticStores.size !== 0);
}

let blockedInstalled = false;
function installNextBlockedHalf(): void {
  if (blockedInstalled) return;
  blockedInstalled = true;
  // Late-bind the optimistic machinery into the plain store/reconcile paths
  // (all call sites are fam?.opt-gated, so this always runs first) and the
  // affects witness's view resolver.
  setOptHooks({
    notifyOptimisticWrites,
    optimisticView,
    applyTentative,
    retainsOptimism: transitionHoldsOptimism
  });
  setNextOptimisticViewResolver((t: StoreNextTarget, raw: any) => optimisticView(t, raw));
  // Scheduler flush tails call _clearOptimisticStores whenever tracked
  // stores exist; next has no layer to clear — reverts are engine-native —
  // so the hook only empties the batch set.
  if (!GlobalQueue._clearOptimisticStores) {
    GlobalQueue._clearOptimisticStores = (stores: Set<any>) => {
      for (const px of stores) {
        const t: StoreNextTarget | undefined = px?.[$TARGET];
        const overlaid = t?.fam?.overlaid as Set<StoreNextTarget> | undefined;
        if (overlaid !== undefined) {
          for (const ot of overlaid) {
            // Keyset resync (classic channel twin): the keyset node's own
            // revert can compare EQUAL (a landing's bump matched the
            // tentative bump) while the arrangement underneath changed —
            // mapArray/ownKeys subscribers must re-read the post-revert
            // view. Authoritative bump: never re-arm the node we are
            // clearing.
            if (ot.k !== null) runAuthoritative(() => setSignal(ot.k!, v => v + 1));
          }
        }
      }
      stores.clear();
    };
  }
  const chained = GlobalQueue._transitionBlocked!;
  GlobalQueue._transitionBlocked = transition => {
    for (const store of transition._optimisticStores) {
      const t = (store as any)?.[$TARGET] as StoreNextTarget | undefined;
      const fam = t?.fam;
      const fw: any = fam?.node;
      // The hold exists to keep optimistic state alive until the store's own
      // truth lands (#2951). Once the family carries NO live overrides (a
      // landing consumed them, or they never existed), a pending firewall is
      // no reason to park the transaction — blocking then leaks it forever
      // when the in-flight question is never answered (undisposed fixtures).
      if (fw == null || !(fw._statusFlags & STATUS_PENDING)) continue;
      // Ownership is declared (#3146): only the flight's OWN transaction
      // parks on the flight (the #2951 anchor routed the bare write there).
      // A transaction that merely brushed the store never waits for truth
      // it does not carry.
      const ft = fam!.ft != null ? liveTransition(fam!.ft) : null;
      if (ft !== null && ft !== currentTransition(transition)) continue;
      if (familyHasLiveOverrides(fam!)) return true;
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
        if (node._x?._overrideValue !== undefined && node._x?._overrideValue !== NOT_PENDING)
          return true;
      }
    }
    if (
      t.k !== null &&
      t.k._x?._overrideValue !== undefined &&
      t.k._x?._overrideValue !== NOT_PENDING
    )
      return true;
  }
  overlaid.clear(); // nothing live — drop the bookkeeping
  return false;
}

export function createOptimisticStoreNext<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStoreNext<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>];
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
  // Same key resolution the projection channels use ("id" default) — replay's
  // satisfaction rule reads it off the family.
  const keyOption = options?.key === undefined ? "id" : options.key;
  fam.key =
    typeof keyOption === "function"
      ? keyOption
      : keyOption === null
        ? null
        : (row: any) => (isWrappable(row) ? row[keyOption] : undefined);
  if (fam.shallow) {
    ((store as any)[$TARGET] as StoreNextTarget as any).s = true;
    markRawIngest(initialValue);
  }

  if (derived) {
    const fn = first as (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>;
    // #3146: an async settle event belongs to the flight's OWN transaction.
    // A live declared one re-enters (a merge if the generic settle path
    // already entered a graph-stamped stranger — the landing supersedes any
    // recompute deriving from that stranger's world); a dead one renews (per
    // A18(1) each arrival reveals on its own schedule, so per-yield
    // transactions die with their commit and the next settle event opens the
    // flight's next one — still declared, never anonymous). An UNDECLARED
    // flight (loading window) keeps the ambient reveal (#2933: the loading
    // rail is transaction-invisible).
    const enterFlightTransition = (): void => {
      const declared = fam.ft;
      if (declared == null) return;
      let ft = liveTransition(declared);
      if (ft === null) fam.ft = ft = createTransition();
      (fam.node as Computed<void>)._transition = ft;
      globalQueue.initTransition(ft);
    };
    // Landing router (#3164 fold ruling): while a transaction retains
    // optimistic edits on this family, truth landings stage INTO it and
    // reveal atomically at settle; with no retainer they commit immediately
    // under the authoritative posture (async commits land outside the
    // computed's sync body, so the posture is re-applied here) — inside the
    // flight-owned transaction (#3146). Sync commits (the derive's body,
    // owner is the firewall itself) reveal with their own recompute's flush.
    const wrapCommit = (write: () => void, value: T) => {
      const txn = retainingTransition(fam);
      if (txn !== null) return void stageLanding(fam, txn, value);
      if (getOwner() !== fam.node) enterFlightTransition();
      runAuthoritative(write);
    };
    // Draft writes (the derive mutating its draft, sync body and post-await
    // continuations alike) are the same truth channel per-operation: bind
    // each op to the retaining transaction so its node writes stage and its
    // backing fold defers (ensurePB stamps foldBatches with the swapped-in
    // batch; the write-override eager-commit branch in notifyWrites yields
    // to any active transaction).
    const aroundDraftWrite = (op: () => void) => {
      const txn = retainingTransition(fam);
      if (txn === null) op();
      else runFolded(txn, op);
    };
    // Flight declaration (#3146): a recompute that registered a truth-flight
    // OWNS its transaction. The ask's transaction is recorded on the family
    // (created by the flight's own pending throw when none was ambient, the
    // causing write's/refresh's when one was — graph-driven causality) and
    // the firewall is stamped so every settle path resolves the flight's
    // transaction by construction, not by whatever last brushed the node.
    // When the ask took none (a dead stale stamp — the previous flight's,
    // cleared nowhere — bare-returns the pre-throw entry), the flight opens
    // its own here, same activation point as the pre-throw's creation: the
    // ambient batch (the causing write, same-tick bare optimism) adopts into
    // it exactly as it would have there, and the pending notification that
    // follows this unwind registers observers against it. The flight
    // also registers as its own async reporter: the transaction lives
    // exactly as long as the question is unanswered, observed or not — the
    // #2951 refetch-hold no longer depends on a tracked observer having
    // happened to register one. Loading-window flights declare nothing
    // (#2933: the loading rail is transaction-invisible); a sync run clears
    // the declaration.
    const declareFlight = (self: Computed<void>): void => {
      if (self._x?._inFlight == null) {
        if (!self._loading) fam.ft = null;
        return;
      }
      if (self._loading) return;
      let txn = activeTransition;
      if (txn === null) globalQueue.initTransition((txn = createTransition()));
      fam.ft = txn;
      self._transition = txn;
      if (__DEV__) beginAsyncReporterWrites();
      let reporters = txn._asyncReporters.get(self);
      if (reporters === undefined) txn._asyncReporters.set(self, (reporters = new Set()));
      reporters.add(self);
      if (__DEV__) endAsyncReporterWrites();
    };
    let nodeOptions: { name?: string; loadingValue?: void } | undefined;
    if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
    if (__DEV__ && options?.name) nodeOptions = { ...nodeOptions, name: options.name };
    const node = computed(() => {
      const self = getOwner() as Computed<void>;
      try {
        runAuthoritative(() =>
          runProjectionComputedNext(
            store,
            fn,
            options?.key === undefined ? "id" : options.key,
            wrapCommit,
            aroundDraftWrite
          )
        );
      } finally {
        declareFlight(self);
      }
    }, nodeOptions) as Computed<void>;
    node._config &= ~CONFIG_AUTO_DISPOSE;
    fam.node = node;
  }

  return [
    store,
    ((fn: (draft: T) => void) => {
      // Retention ledger (#3164): record the owning transaction so landings
      // know to fold. Captured at entry — the action machinery has the
      // transaction ambient while user code runs; a bare write with no
      // transaction retains nothing (it rides the flight's own transition
      // per #2951 and dies with it).
      const txn = activeTransition;
      storeSetterNext(store, fn);
      if (txn !== null) (fam.rt ??= new Set()).add(txn);
    }) as StoreSetter<T>
  ];
}

/** Resolve a retained transition through its merge chain (`_done` holds the
 * merge target while merged, `true` once settled). Null = dead. */
function liveTransition(txn: Transition): Transition | null {
  while (typeof txn._done === "object") txn = txn._done as Transition;
  return txn._done === true ? null : txn;
}

/** The transaction truth landings fold into: the first live member of the
 * family's retention ledger (dead members prune here). Multiple live
 * retainers entangle through their shared family writes and settle
 * together, so folding into the first reaches all of them. */
function retainingTransition(fam: StoreNextFamily): Transition | null {
  const rt = fam.rt as Set<Transition> | undefined;
  if (rt === undefined || rt.size === 0) return null;
  let live: Transition | null = null;
  for (const txn of rt) {
    const resolved = liveTransition(txn);
    if (resolved === null) rt.delete(txn);
    else live ??= resolved;
  }
  return live;
}

/** Fold a landing into the retaining transaction (#3164): the landed value
 * is written through the ORDINARY staged setter channel — node writes park
 * as `_pendingValue` registered with the transaction's batch (speculation
 * and until()'s authoritative tunnel see them; live view stays coherent),
 * and the backing fold defers via the foldBatches stamp — under the
 * authoritative posture, so armed nodes take the engine bypass and no
 * override is created. The engine's own commit machinery reveals everything
 * atomically when the transaction settles (transitions never abort: failed
 * actions still commit — only optimistic overrides revert). */
function stageLanding(fam: StoreNextFamily, txn: Transition, incoming: unknown): void {
  runFolded(txn, () =>
    runAuthoritative(() =>
      storeSetterNext(
        fam.px,
        (draft: any) => {
          stagedApply(draft, unwrapValue(incoming), fam.key ?? null);
        },
        false
      )
    )
  );
}

/** Run a fold write inside the retaining transaction's batch, then
 * transition-stamp its staged nodes NOW (parity with the parked-transition
 * flush path's reassignPendingTransition): the stamp is what routes stale
 * (render) readers to the committed value — core read's cross-transaction
 * guard — and what makes foldHeld defer the backing for context-free
 * readers. A microtask staging never crosses that flush path, so without
 * the stamp a render effect's speculative recompute would compose staged
 * truth with live overrides — the #3164 tear, one window later. Armed
 * nodes additionally raise CONFIG_HELD_TRUTH: their staged value is
 * confirming truth masked from ordinary readers until the reveal (plain
 * staged nodes stay visible — normal speculation; override-covered nodes
 * stay unarmed — the override is their display and its revert their
 * notification, A17). */
function runFolded(txn: Transition, op: () => void): void {
  runAsTransitionBatch(txn, op);
  const pending = txn._pendingNodes;
  for (let i = 0; i < pending.length; i++) {
    const node = pending[i];
    node._transition = txn;
    if (node._config & CONFIG_OPTIMISTIC && !hasActiveOverride(node))
      node._config |= CONFIG_HELD_TRUTH;
  }
}

/** Keyed identity-preserving deep merge through live draft proxies — the
 * staged twin of the adoption walk. Reads see the pending backing (staged
 * view), so consecutive landings during one hold compose; key-matched rows
 * keep their raw (and so their proxy) in the slot with only changed leaves
 * written; unmatched rows land wholesale. Runs inside stageLanding's
 * authoritative bracket: drafts seed from committed truth, never overlays. */
function stagedApply(cur: any, incoming: any, keyFn: KeyFn | null): void {
  const curArr = Array.isArray(cur);
  if (curArr && Array.isArray(incoming)) {
    const len = incoming.length;
    if (keyFn !== null) {
      // Occurrence-aware key queues (parity with the adoption window):
      // duplicate keys match per occurrence, each current row consumed once.
      let byKey: Map<any, any[]> | null = null;
      const curLen = cur.length;
      for (let j = 0; j < curLen; j++) {
        const raw = unwrapValue(cur[j]);
        if (!isWrappable(raw)) continue;
        const k = keyFn(raw);
        if (k === undefined) continue;
        const q = (byKey ??= new Map()).get(k);
        if (q === undefined) byKey.set(k, [raw]);
        else q.push(raw);
      }
      // Echo adoption: an optimistic structural add whose key the landing
      // confirms must keep its raw (and so its proxy — list drivers keep the
      // DOM row). Tentative rows never reach committed truth (they live in
      // node overrides), so key-match the draft target's active override
      // rows as a secondary pool. Committed rows queued first own their
      // keys; overlay rows only extend coverage. Adopted raws enter staged
      // truth; at settle the override reverts and the reveal re-seats the
      // same raw.
      const overlayNodes = ((cur as any)[$TARGET] as StoreNextTarget | undefined)?.n;
      if (overlayNodes != null) {
        for (const ok of Reflect.ownKeys(overlayNodes)) {
          const node = overlayNodes[ok as any];
          if (!hasActiveOverride(node)) continue;
          const raw = unwrapValue(unwrapOverride(node._x!._overrideValue));
          if (!isWrappable(raw)) continue;
          const k = keyFn(raw);
          if (k === undefined) continue;
          const q = (byKey ??= new Map()).get(k);
          if (q === undefined) byKey.set(k, [raw]);
          else q.push(raw);
        }
      }
      for (let i = 0; i < len; i++) {
        const nv = incoming[i];
        let matched: any;
        if (isWrappable(nv) && byKey !== null) {
          const nk = keyFn(nv);
          if (nk !== undefined) {
            for (const [k, q] of byKey) {
              if (!sameKey(k, nk)) continue;
              matched = q.shift();
              if (q.length === 0) byKey.delete(k);
              break;
            }
          }
        }
        if (matched !== undefined) {
          if (unwrapValue(cur[i]) !== matched) cur[i] = matched;
          stagedApply(cur[i], nv, keyFn);
        } else {
          const pv = unwrapValue(cur[i]);
          if (!isEqual(pv, nv) && !targetsEqual(pv, nv)) cur[i] = nv;
        }
      }
    } else {
      for (let i = 0; i < len; i++) {
        const nv = incoming[i];
        const pv = unwrapValue(cur[i]);
        if (pv === nv) continue;
        if (isWrappable(nv) && isWrappable(pv) && Array.isArray(nv) === Array.isArray(pv))
          stagedApply(cur[i], nv, keyFn);
        else if (!isEqual(pv, nv) && !targetsEqual(pv, nv)) cur[i] = nv;
      }
    }
    if (cur.length !== len) cur.length = len;
    return;
  }
  // Object merge; also the degenerate root-kind-change shape (arrays accept
  // keyed writes/deletes, so a wholesale restatement still lands staged).
  for (const k of Reflect.ownKeys(incoming)) {
    if (curArr && k === "length") continue;
    const nv = (incoming as any)[k];
    const pv = unwrapValue(cur[k]);
    if (pv === nv) continue;
    if (isWrappable(nv) && isWrappable(pv) && Array.isArray(nv) === Array.isArray(pv)) {
      // Different-keyed entities never merge (tentative-channel parity):
      // the incoming object replaces the slot wholesale.
      if (keyFn !== null) {
        const pk = keyFn(pv);
        const nk = keyFn(nv);
        if (pk !== undefined && nk !== undefined && !sameKey(pk, nk)) {
          cur[k] = nv;
          continue;
        }
      }
      stagedApply(cur[k], nv, keyFn);
    } else if (!isEqual(pv, nv) && !targetsEqual(pv, nv)) {
      cur[k] = nv;
    }
  }
  for (const k of Reflect.ownKeys(cur)) {
    if ((curArr && k === "length") || k in incoming) continue;
    delete cur[k];
  }
}

// ---- optimistic-only store machinery (moved from next/store.ts /
// next/reconcile.ts so plain-store bundles tree-shake it) ----

/** Diff the draft against the current OPTIMISTIC VIEW (committed + active
 * overrides — the same view the draft was seeded from) and emit engine writes
 * for exactly the changed keys. Visible-view diffing keeps no-op writes from
 * entangling lanes (RUL-10 / opt R38). */
export function notifyOptimisticWrites(t: StoreNextTarget, pb: Record<PropertyKey, any>): void {
  // A bare write while the store's own truth is in flight rides the FLIGHT'S
  // OWN transaction (#2951 via the #3146 declaration): entangle it so the
  // override survives until the refetch settles instead of flash-reverting
  // at plain flush end. The blocked-check store-half keeps that transaction
  // from settling while the firewall is pending. Declared ownership replaces
  // the old circumstantial route through the firewall's `_transition` stamp,
  // which was whatever last brushed the node.
  const declared = t.fam?.ft;
  if (declared != null) {
    const ft = liveTransition(declared);
    if (ft !== null) globalQueue.initTransition(ft);
  }
  const old = t.v;
  const visible = (key: PropertyKey, fallback: any): any => {
    const node = t.n?.[key as any];
    return node !== undefined && hasActiveOverride(node)
      ? unwrapOverride(node._x?._overrideValue)
      : fallback;
  };
  const visiblePresent = (key: PropertyKey): boolean => {
    const node = t.h?.[key as any];
    return node !== undefined && hasActiveOverride(node)
      ? !!unwrapOverride(node._x?._overrideValue)
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
  // Deep-witness: optimistic value writes notify deep() subscribers too
  // (structural ones already ride the key-set bump above).
  bumpDeep(t);
  // Discard the draft — committed raw is untouched (revert target by
  // construction) — restoring any truth-staged backing this draft displaced
  // (#3164 fold: ensurePB parked it so tentative writes could not pollute
  // staged truth). Register the root store for the scheduler's settle hooks.
  t.pb = stagedTruthPB.get(t) ?? null;
  if (t.pb !== null) stagedTruthPB.delete(t);
  (t.fam!.overlaid ??= new Set()).add(t);
  GlobalQueue._trackOptimisticStore?.(t.fam!.px ?? t.px);
}

/** Optimistic-view composition for snapshot/deep (O1: snapshot is the CURRENT
 * view, lane values included; a fresh copy per call during pending windows —
 * RUL-12). Returns `src` untouched when no override is active on `t`.
 * Authoritative-view reads (until()'s predicate) skip composition entirely:
 * the predicate observes authoritative truth, never the caller's tentative
 * overlay. (Write-side emission callers never run under such a compute.) */
export function optimisticView(
  t: StoreNextTarget,
  src: Record<PropertyKey, any>
): Record<PropertyKey, any> {
  if (t.fam?.opt !== true || authoritativeRead()) return src;
  let out: Record<PropertyKey, any> | null = null;
  const ensure = () => (out ??= Array.isArray(src) ? [...(src as any[])] : { ...src });
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) {
      const node = nodes[key as any];
      if (!hasActiveOverride(node)) continue;
      const ov = unwrapOverride(node._x?._overrideValue);
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
      const present = !!unwrapOverride(node._x?._overrideValue);
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
      // SameValueZero (re-audit 3, P1-3): parity with the plain reconcile
      // channel — NaN keys are self-equal.
      if (pk !== undefined && nk !== undefined && !sameKey(pk, nk)) return null;
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
            // Occurrence-aware index queues (re-audit 3, P1-3): parity with
            // the plain adoption window — duplicate keys match per
            // occurrence, each view row consumed once.
            viewByKey = new Map();
            for (let j = 0; j < viewRows.length; j++) {
              const p = unwrapValue(viewRows[j]);
              if (isWrappable(p)) {
                const pk = keyFn(p);
                if (pk === undefined) continue;
                const existing = viewByKey.get(pk);
                if (existing === undefined) viewByKey.set(pk, j);
                else if (Array.isArray(existing)) existing.push(j);
                else viewByKey.set(pk, [existing, j]);
              }
            }
          }
          const m = viewByKey.get(nk);
          if (m === undefined) pv = undefined;
          else if (Array.isArray(m)) {
            pv = unwrapValue(viewRows[m.shift()!]);
            if (m.length === 1) viewByKey.set(nk, m[0]);
          } else {
            pv = unwrapValue(viewRows[m]);
            viewByKey.delete(nk);
          }
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
