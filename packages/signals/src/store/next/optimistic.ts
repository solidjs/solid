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
import { ext } from "../../core/core.js";
import {
  CONFIG_AUTHORITATIVE_OBSERVED,
  NOT_PENDING,
  STATUS_PENDING,
  unwrapOverride,
  CONFIG_OPTIMISTIC
} from "../../core/constants.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  isEqual,
  setSignal,
  type Computed,
  type Signal
} from "../../core/index.js";
import {
  GlobalQueue,
  globalQueue,
  insertSubs,
  schedule,
  activeTransition,
  projectionWriteActive,
  runAsTransitionBatch,
  setProjectionWriteActive,
  type Transition
} from "../../core/scheduler.js";
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
  arrayStructureChanged,
  bumpDeep,
  authoritativeRead,
  getHasNode,
  getKeySetNode,
  getNode,
  hasActiveOverride,
  membershipChanged,
  runAuthoritative,
  storeSetterNext,
  targetsEqual,
  unwrapValue,
  wrapNext
} from "./store.js";
// Patch-channel emission rides installed hooks (patch-hooks.ts); all
// calls are `t.pc`-guarded. See patch-hooks.ts for the soundness argument.
import { patchHooks, rowHooks } from "./patch-hooks.js";
// Cycle with reconcile.js is benign: the binding resolves at call time (the
// optimistic write), long after both modules initialize.
import { buildIdentityRowOps, sameKey } from "./reconcile.js";
import { setOptHooks, storeNextLookup } from "./target.js";
type KeyFn = (item: any) => any;
import {
  getWriteOverride,
  isRawValue,
  isWrappable,
  rawValuesUsed,
  setNextOptimisticViewResolver,
  setWriteOverride
} from "../store.js";
import type { StoreNextFamily, StoreNextTarget } from "./target.js";

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
    _markLandingContradiction
  });
  setNextOptimisticViewResolver((t: StoreNextTarget, raw: any) => optimisticView(t, raw));
  // Scheduler flush tails call _clearOptimisticStores whenever tracked
  // stores exist; next has no layer to clear — reverts are engine-native —
  // so the hook only empties the batch set.
  if (!GlobalQueue._clearOptimisticStores) {
    GlobalQueue._clearOptimisticStores = (stores: Set<any>) => {
      // Patch channel (revert site): engine-native reverts flip node values
      // back to committed; patched records need a forced DOM re-apply from
      // the post-revert view. Emission only — next keeps no layer to clear.
      for (const px of stores) {
        const t: StoreNextTarget | undefined = px?.[$TARGET];
        // Retained-edit reckoning first: a settling transaction's engine
        // reverts ran above this drain, so survivors re-derive here — the
        // patch/row-ops resyncs below then emit from the post-replay view.
        if (t?.fam !== undefined && t.fam !== null) rederiveAtSettle(t.fam);
        const overlaid = t?.fam?.overlaid as Set<StoreNextTarget> | undefined;
        if (overlaid !== undefined) {
          for (const ot of overlaid) {
            if (ot.pc !== null && ot.pc.p !== null) patchHooks!.emitPatchOptimistic(ot, null, null);
            // Row-ops resync (family increment 2): reverts flip node values
            // back engine-natively; a driven list must rebuild retention by
            // row identity against the post-revert view (resolved from the
            // target at drain — overrides are gone by then).
            if (ot.pc !== null && ot.pc.ro !== null) rowHooks!.emitRowOpsOptimistic(ot, null, null);
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
    // Async commits land outside the computed's sync body — re-apply the
    // authoritative-write posture there too. Landings run the family's
    // RUL-2 reckoning: equal landings hold, contradicting continuations
    // rebase retained edits, contradicting REPLACEMENTS (an invocation's
    // first commit — navigation/refresh/poll, #2719) drop them. Draft
    // writes are continuations by construction (flight-gated at the trap).
    const consume = (replacing?: boolean) => consumeOverridesNext(fam, replacing === true);
    const wrapCommit = (write: () => void, replacing?: boolean) => {
      runAuthoritative(write);
      consume(replacing);
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

  return [
    store,
    ((fn: (draft: T) => void) => {
      // Function-of-truth retention (#3123 re-ruling): the setter call IS
      // the tentative intent — retain it with its owning transaction so a
      // contradicting landing can re-derive it against the new base instead
      // of consuming it (the armed nodes it materializes into are positional
      // claims a landing invalidates; the function re-derives its positions).
      // Captured at entry: the action machinery has the transaction ambient
      // while user code runs — a bare write with no transaction retains
      // nothing (it reverts at flush end; nothing to re-derive). Replays
      // themselves never re-retain.
      const txn = replaying ? null : activeTransition;
      storeSetterNext(store, fn);
      if (txn !== null) (fam.re ??= []).push([txn, fn]);
    }) as StoreSetter<T>
  ];
}

/** Resolve a retained transition through its merge chain (`_done` holds the
 * merge target while merged, `true` once settled). Null = dead. */
function liveTransition(txn: Transition): Transition | null {
  while (typeof txn._done === "object") txn = txn._done as Transition;
  return txn._done === true ? null : txn;
}

let replaying = false;

/** Replay the family's live retained edits against the freshly landed base
 * (RUL-2 as re-ruled: a landing wins wholesale, and what stands on top is
 * re-EXECUTED declarations of still-open transactions — never salvaged node
 * values). Runs after the consumption walk, outside the authoritative
 * posture, so each setter routes down the ordinary tentative channel and
 * arms fresh nodes against its own transaction. The visible-view diff in
 * notifyOptimisticWrites makes replay idempotent against overrides that
 * survived (an equal re-write emits nothing). Setters are reducers by
 * contract (pure draft mutation, idempotent over plausible bases — the
 * server-echo window replays an edit the landing may already carry);
 * a replay that throws forfeits its entry, leaving landed truth. */
function replayRetainedEdits(fam: StoreNextFamily): void {
  const edits = fam.re;
  if (edits === undefined || edits.length === 0) return;
  // Both posture flags clear, not just the projection one: the draft-write
  // landing channel invokes consumption from INSIDE a draft trap, which
  // holds the write override — inherited, it would route these re-executions
  // down the authoritative path and commit tentative intent as truth.
  const prevPosture = projectionWriteActive;
  setProjectionWriteActive(false);
  const prevOverride = getWriteOverride();
  setWriteOverride(false);
  replaying = true;
  let kept = 0;
  try {
    for (let i = 0; i < edits.length; i++) {
      const txn = liveTransition(edits[i][0]);
      if (txn === null) continue; // settled/aborted — the edit died with it
      try {
        // Batch swap, not just the ambient-transaction swap: re-armed nodes
        // REGISTER through the queue's batch pointer, and left in the
        // interrupted window's plain batch they revert at its next flush —
        // a one-frame collapse to base with nothing in the trace to blame.
        runAsTransitionBatch(txn, () => storeSetterNext(fam.px, edits[i][1]));
      } catch (error) {
        if (__DEV__) {
          console.error(
            "An optimistic setter threw while re-deriving against freshly " +
              "landed data. Optimistic setters are reducers: they re-run " +
              "whenever authoritative truth changes beneath them, so they " +
              "must tolerate any plausible base. This edit is dropped — the " +
              "landed truth stands.",
            error
          );
        }
        continue;
      }
      edits[kept][0] = txn;
      edits[kept][1] = edits[i][1];
      kept++;
    }
  } finally {
    edits.length = kept;
    replaying = false;
    setWriteOverride(prevOverride);
    setProjectionWriteActive(prevPosture);
  }
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
  // Replay satisfaction rule (#3123 re-ruling): a re-executed add whose key
  // the draft already carries earlier (the landing echoed this transaction's
  // own row) was satisfied by that landing — keep-first per key, drop the
  // later duplicate. A keyed store cannot hold two rows with one key; the
  // system re-ran the setter, so the system dedupes. Replay-only: a FIRST
  // write's shape is the user's own, and unkeyed rows (key: null, or rows
  // without the key) stay untouched — their idempotency is the documented
  // reducer contract.
  const keyFn = replaying ? t.fam?.key : null;
  if (keyFn != null && Array.isArray(pb)) {
    let seen: Set<any> | null = null;
    let deduped: any[] | null = null;
    for (let i = 0; i < pb.length; i++) {
      const rowKey = keyFn(unwrapValue(pb[i]));
      if (rowKey === undefined) {
        deduped?.push(pb[i]);
        continue;
      }
      if ((seen ??= new Set()).has(rowKey)) {
        // first duplicate: materialize the filtered copy lazily
        deduped ??= (pb as any[]).slice(0, i);
        continue;
      }
      seen.add(rowKey);
      deduped?.push(pb[i]);
    }
    if (deduped !== null) pb = deduped;
  }
  const old = t.v;
  // Patch channel (override-application site): the draft IS the intended
  // visible state; prev is the view before these overrides apply. Bypasses
  // the transition stash — optimism is visible in flight.
  if (t.pc !== null && t.pc.p !== null)
    patchHooks!.emitPatchOptimistic(t, pb, optimisticView(t, old));
  // Row-ops channel (family increment 2): optimistic STRUCTURE on an array
  // rides node overrides — it never enters the reconcile walk — so a driven
  // list must get its structural ops here, lane-timed. Identity diff of the
  // pre-write optimistic view against the draft; aligned writes emit nothing.
  if (t.pc !== null && t.pc.ro !== null && Array.isArray(pb)) {
    const prevView = optimisticView(t, old);
    if (Array.isArray(prevView)) {
      const ops = buildIdentityRowOps(prevView, pb);
      if (ops !== null) rowHooks!.emitRowOpsOptimistic(t, pb, ops);
    }
  }
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
  // construction). Register the root store for the scheduler's settle hooks
  // and the target for landing consumption (RUL-2).
  t.pb = null;
  (t.fam!.overlaid ??= new Set()).add(t);
  GlobalQueue._trackOptimisticStore?.(t.fam!.px ?? t.px);
}

/** Targets whose CURRENT landing changed their key-set verdict (RUL-2
 * consumption gate, #3123). Marked by the adoption notify sites (store.ts,
 * via optHooks) inside the same authoritative commit that calls
 * consumeOverridesNext, which intersects and clears — the set never
 * outlives its landing window. Marks are admitted only for overlaid
 * targets so a landing that precedes the override can never go stale. */
const contradicted = new Set<StoreNextTarget>();

function _markLandingContradiction(
  t: StoreNextTarget,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  // Only overlaid targets can be contradicted (nothing to consume otherwise),
  // so non-overlaid adoptions pay one short-circuited lookup — and a mark can
  // never predate its overrides and go stale across landing windows.
  if (t.fam!.overlaid?.has(t) !== true || contradicted.has(t)) return;
  const changed =
    Array.isArray(neu) && Array.isArray(old)
      ? arrayStructureChanged(old, neu)
      : membershipChanged(old, neu);
  if (changed) contradicted.add(t);
}

/** Drop a target's STRUCTURAL overrides (legacy layer parity): membership
 * edits, array length, and the value overrides written WITH them (a key
 * carrying an active presence override is an add/delete — classified BEFORE
 * the adoption may have made the key exist in landed data). A pure value
 * override on a key the landing carries stays with its owning transaction
 * (rapid-toggle contract: a live action's edit of an existing entity rides
 * on top of landed truth). Callers hold the authoritative posture. */
function wipeStructuralOverrides(t: StoreNextTarget): void {
  const drop = (node: Signal<any>, committed: any) => {
    if (!hasActiveOverride(node)) return;
    const prev = unwrapOverride(node._x?._overrideValue);
    // Full legacy reset (clearOptimisticOverride parity): the landing is
    // authoritative NOW — fold committed into the node directly instead
    // of riding a transaction's commit (whose queues may be stashed with
    // the transaction parked; the wake would strand until it settles).
    ext(node)._overrideValue = NOT_PENDING;
    node._config |= CONFIG_OPTIMISTIC;
    const nx = (node as any)._x;
    if (nx) {
      nx._overrideOwner = null;
      nx._optimisticLane = undefined;
    }
    node._pendingValue = NOT_PENDING;
    node._value = committed;
    if (!node._equals || !node._equals(prev, committed)) {
      insertSubs(node, true);
      schedule();
    } else if (node._config & CONFIG_AUTHORITATIVE_OBSERVED) {
      // Landing equal to the override is silent for A17 readers, but a
      // authoritative-view reader (until()) that observed this node past its
      // override is waiting for exactly this arrival — wake it alone.
      // (Hook installed by until(), the only setter of the gating bit.)
      GlobalQueue._notifyAuthoritativeObservers!(node);
    }
  };
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
      const structural = structuralKeys?.has(key) || !(key in t.v) || (isArr && key === "length");
      if (!structural) continue;
      drop(nodes[key as any], isArr && key === "length" ? (t.v as any[]).length : t.v[key as any]);
    }
  }
  if (has !== null) {
    for (const key of Reflect.ownKeys(has)) drop(has[key as any], key in t.v);
  }
  if (t.k !== null && hasActiveOverride(t.k)) {
    ext(t.k)._overrideValue = NOT_PENDING;
    t.k._config |= CONFIG_OPTIMISTIC;
    const kx = (t.k as any)._x;
    if (kx) {
      kx._overrideOwner = null;
      kx._optimisticLane = undefined;
    }
    insertSubs(t.k, true);
    schedule();
  }
  // Patch channel (override-consumption site): visible truth flipped to
  // committed for the consumed keys — force a re-apply from the live
  // view so the DOM leaves the override state.
  if (t.pc !== null && t.pc.p !== null) patchHooks!.emitPatchOptimistic(t, null, null);
}

/** Settle-time re-derivation (#3123 re-ruling, the second reckoning point):
 * when a RETAINING transaction dies (engine reverts already dropped its own
 * armed nodes above this drain), the survivors' materializations were
 * computed against a base that included the dead transaction's rows — a
 * positional claim the revert just invalidated (the layered-patch hole:
 * B's index-2 row floating over a base that lost A's index 1). Same answer
 * as a contradicting landing: wipe the family's structural overrides and
 * re-execute the still-live edits against what actually stands. No dead
 * entry means the armed state is still the edits' own materialization —
 * skip (the common plain-flush drain pays one liveness scan). */
function rederiveAtSettle(fam: StoreNextFamily): void {
  const edits = fam.re;
  if (edits === undefined || edits.length === 0) return;
  let died = false;
  for (let i = 0; i < edits.length; i++) {
    if (liveTransition(edits[i][0]) === null) {
      died = true;
      break;
    }
  }
  if (!died) return;
  const overlaid = fam.overlaid;
  if (overlaid !== undefined) {
    runAuthoritative(() => {
      // Not cleared: the drain's patch/row-ops resync loop below reads
      // overlaid to tell a driven list the view flipped — clearing here
      // starved it and the DOM kept the reverted rows. Stale entries prune
      // lazily (familyHasLiveOverrides), same as the engine-revert path.
      for (const t of overlaid as Set<StoreNextTarget>) wipeStructuralOverrides(t);
    });
  }
  replayRetainedEdits(fam);
}

/**
 * Landing consumption (RUL-2, equality-scoped per #3123): fresh authoritative
 * data supersedes the tentative overrides it CONTRADICTS — a landing that
 * left a target's arrangement unchanged (per-key equal poll) carries no new
 * information about it, so its deltas stay valid and hold with their owning
 * transaction (they still revert at owner settle). The contradiction verdict
 * is the key-set predicate itself: any array index/length change (positional
 * identity IS content — non-keyed deltas anchor to the exact arrangement),
 * object membership change. Consumed targets mirror legacy
 * clearProjectionOverride — drop the override, clear lane/ownership, notify
 * subscribers whose visible value changes (reversion effects go to regular
 * queues via the projection write posture the caller holds).
 */
export function consumeOverridesNext(fam: StoreNextFamily, replacing: boolean): void {
  const overlaid = fam.overlaid;
  if (overlaid === undefined || overlaid.size === 0) {
    contradicted.clear();
    return;
  }
  let consumed = false;
  runAuthoritative(() => {
    for (const t of overlaid as Set<StoreNextTarget>) {
      if (!contradicted.has(t)) continue;
      consumed = true;
      overlaid.delete(t);
      wipeStructuralOverrides(t);
    }
    contradicted.clear();
  });
  if (!consumed) return;
  // The reckoning's second half (#3123 re-ruling, flight-gated). A REPLACING
  // landing — the invocation's first commit: the derive re-asked its
  // question from scratch (navigation, refresh, poll) — is a complete
  // restatement of the store's truth, and retained edits die with the
  // answer they were declared against (#2719: a pending add must not ghost
  // onto the next dataset). A CONTINUATION — later yields and draft writes
  // of the live flight: one living answer advancing — rebases instead:
  // still-open transactions' retained edits re-execute against what landed.
  // Equal landings reach neither (nothing consumed above). Replay runs
  // outside the authoritative posture — these are tentative writes arming
  // fresh nodes for their owners.
  if (replacing) {
    if (fam.re !== undefined) fam.re.length = 0;
  } else {
    replayRetainedEdits(fam);
  }
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
