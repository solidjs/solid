/**
 * Store rewrite — reconcile, the adoption channel (INTERNALS-STORE-STATE.md
 * §3, decision 2026-08-16c). Reconcile never merge-writes: it adopts `next`
 * as the authoritative pending backing at every proxied level (pointer swap
 * folded at flush commit), notification riding the fold's descriptor diff.
 *
 * Structural optimizations (all kept, per 2026-08-17 morning ruling):
 * - Identity skip with completed proof: `incoming === backing && !owned` —
 *   sound because input is immutable by convention (R2a) and ownership marks
 *   the only writer the convention doesn't cover (us). Fixes FINDING-1.
 * - Reachability pruning: descent happens only where a child TARGET exists
 *   (proxies exist only where read) — never-subscribed subtrees are never
 *   walked (recon-snap R17), while a subscriber deep below an untracked path
 *   keeps its chain walkable because wrapping created the intermediate
 *   targets (recon-snap R16).
 * - Keyed matching ported semantics: key-matched rows keep proxy identity;
 *   key mismatch detaches (fresh proxy on next read, recon-snap R18);
 *   keyless items fall back positional; null/primitive slots are legal
 *   members (R11). Kind changes replace wholesale (R10).
 */
import { reconcile as legacyReconcile } from "../reconcile.js";
import {
  $PROXY,
  $TARGET,
  isRawValue,
  isWrappable,
  rawValuesUsed,
  storeLookup as legacyStoreLookup
} from "../store.js";
import { adoptPB, unwrapValue } from "./store.js";
import { ownedRaw, storeNextLookup, type StoreNextFamily, type StoreNextTarget } from "./target.js";

type KeyFn = (item: any) => any;

export function reconcileNextState(
  value: any,
  state: any,
  key: string | KeyFn | null | undefined,
  replace = false
): void {
  if (state == null) throw new Error(__DEV__ ? "Cannot reconcile null or undefined state" : "");
  const t: StoreNextTarget | undefined = state?.[$TARGET];
  if (t === undefined || t.px !== state)
    throw new Error(__DEV__ ? "reconcile target is not a store proxy" : "");
  let keyFn: KeyFn | null =
    key === null ? null : typeof key === "string" ? (item: any) => item?.[key] : (key as KeyFn);
  // §7b chained backing: a projection derive returning a LIVE store proxy
  // adopts the proxy itself as the backing — reads flow through the inner
  // store's traps, so consumers subscribe to the inner graph and updates
  // flow with no re-derive (#2941). The adoption diff still notifies THIS
  // store's existing subscribers of the swap.
  if (replace && value !== state && value?.[$TARGET] !== undefined) {
    const prev = t.pb ?? t.v;
    if (prev === value) return; // already chained to this store
    adoptPB(t, value);
    return;
  }
  const incoming = unwrapValue(value);
  if (keyFn) {
    // Root identity precondition — checked before ANY mutation, so a throwing
    // reconcile is atomic by construction (RUL-12 ruling). Projections
    // (replace=true) relax it: a root entity change merges in place — the
    // root proxy is stable for life (proj R5/R11) — and children are NOT
    // key-matched across the entity change (proj R7: keyFn drops to
    // positional so old-entity subtrees never merge into the new entity's).
    const prev = t.pb ?? t.v;
    const eq = keyFn(prev);
    if (eq !== undefined && keyFn(incoming) !== eq) {
      if (!replace)
        throw new Error(__DEV__ ? "Cannot reconcile states with different identity" : "");
      // Entity change: wholesale swap. The root proxy is stable for life
      // (proj R5) but NOTHING below survives — children are never matched
      // across an entity change even when their own keys align (proj R7).
      // Displaced-raw unregistration (proj R10): the outgoing raw stops
      // resolving to this proxy; re-handed later it wraps fresh.
      (t.fam?.map ?? storeNextLookup).delete(t.pb ?? t.v);
      adoptPB(t, incoming);
      return;
    }
  }
  applyAdopt(t, incoming, keyFn, replace);
}

function applyAdopt(t: StoreNextTarget, incoming: any, keyFn: KeyFn | null, proj = false): void {
  const prev = t.pb ?? t.v;
  // The sound identity skip (O7): same reference AND we never diverged it.
  if (incoming === prev && !ownedRaw.has(prev)) return;
  const fam = t.fam;
  const nextArr = Array.isArray(incoming);
  adoptPB(t, incoming);
  if (Array.isArray(prev) !== nextArr) return;
  if (nextArr) {
    const prevRows = prev as any[];
    const nextRows = incoming as any[];
    if (keyFn) {
      let prevByKey: Map<any, any> | null = null;
      for (let i = 0; i < nextRows.length; i++) {
        const nv = nextRows[i];
        if (!isWrappable(nv)) continue;
        const nk = keyFn(nv);
        let pv: any;
        if (nk !== undefined) {
          if (prevByKey === null) {
            prevByKey = new Map();
            for (let j = 0; j < prevRows.length; j++) {
              const p = unwrapValue(prevRows[j]);
              if (isWrappable(p)) {
                const pk = keyFn(p);
                if (pk !== undefined && !prevByKey.has(pk)) prevByKey.set(pk, p);
              }
            }
          }
          pv = prevByKey.get(nk);
        } else {
          pv = unwrapValue(prevRows[i]); // keyless item: positional fallback
        }
        descend(pv, nv, keyFn, fam, proj);
      }
    } else {
      const len = Math.min(prevRows.length, nextRows.length);
      for (let i = 0; i < len; i++)
        descend(unwrapValue(prevRows[i]), nextRows[i], keyFn, fam, proj);
    }
  } else {
    for (const k of Reflect.ownKeys(incoming)) {
      descend(unwrapValue((prev as any)[k]), (incoming as any)[k], keyFn, fam, proj);
    }
  }
}

function descend(
  pv: any,
  nv: any,
  keyFn: KeyFn | null,
  fam: StoreNextFamily | null,
  proj = false
): void {
  if (!isWrappable(pv) || !isWrappable(nv)) return;
  // markRaw'd values are leaves for reconcile: replaced by reference, never
  // recursed into (R42); the parent's slot notification covers the change.
  if (rawValuesUsed && (isRawValue(pv) || isRawValue(nv))) return;
  nv = unwrapValue(nv);
  // A child tracked by the LEGACY store (shallow store nested in a next deep
  // store, R45) reconciles through the legacy machinery on its own proxy.
  const lt = legacyStoreLookup.get(pv);
  if (lt !== undefined) {
    legacyReconcile(nv, keyFn ?? null)((lt as any)[$PROXY]);
    return;
  }
  // Kind change replaces wholesale, never merges (R10): a target's carrier
  // class (array vs object) is fixed at creation, so the slot detaches and a
  // fresh proxy of the right kind wraps the incoming value on next read.
  if (Array.isArray(pv) !== Array.isArray(nv)) return;
  if (keyFn) {
    const pk = keyFn(pv);
    const nk = keyFn(nv);
    // Key mismatch detaches: the slot takes the new entity; the old proxy
    // keeps its (old) backing and a fresh proxy wraps the new value on read.
    if (pk !== undefined && nk !== undefined && pk !== nk) return;
  }
  const ct = (fam?.map ?? storeNextLookup).get(pv);
  if (ct === undefined) return; // nothing proxied below this pair
  // Reachability pruning (§6d) is MODE-dependent, both pinned:
  // - keyed matching descends only where subscriptions exist at/below (`d`) —
  //   captured-but-unobserved proxies deliberately detach and go stale
  //   (recon-snap R18; subscribing is what buys liveness);
  // - positional (key: null) pairing preserves slot identity unconditionally
  //   (recon-snap R8 — the fixed-shape dashboard pattern).
  // Projection merges (replace mode) preserve key-matched identity
  // UNCONDITIONALLY (proj R6: the slot keeps its proxy without needing a
  // subscriber below); plain keyed reconcile detaches unobserved captures
  // (recon-snap R18 — staleness is the pinned pruning contract).
  if (!proj && keyFn !== null && !ct.d) return;
  applyAdopt(ct, nv, keyFn, proj);
}
