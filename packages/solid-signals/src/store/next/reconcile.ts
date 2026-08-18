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
import {
  $PROXY,
  $TARGET,
  isRawValue,
  isWrappable,
  markRawIngest,
  rawValuesUsed
} from "../store.js";
import {
  adoptPB,
  hasAccessorFlag,
  notifyFold,
  notifyFoldTail,
  notifyKeyDiff,
  notifyKeyValue,
  notifyOptimisticWrites,
  optimisticView,
  unwrapValue
} from "./store.js";
import { ownedRaw, storeNextLookup, type StoreNextFamily, type StoreNextTarget } from "./target.js";
import { getWriteOverride } from "../store.js";
import { projectionWriteActive } from "../../core/scheduler.js";

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
  // Tentative channel (§6b, RUL-5): a user-context reconcile on an optimistic
  // family parks as engine overrides — values, membership, and length ride
  // armed nodes (reverting with their transaction); committed raw is never
  // touched. Key-matched rows keep proxy identity by descending into the
  // existing child targets instead of overriding their parent slots.
  if (t.fam?.opt === true && !projectionWriteActive && !getWriteOverride()) {
    applyTentative(t, incoming, keyFn);
    return;
  }
  applyAdopt(t, incoming, keyFn, replace);
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

function applyAdopt(t: StoreNextTarget, incoming: any, keyFn: KeyFn | null, proj = false): void {
  const prev = t.pb ?? t.v;
  // The sound identity skip (O7): same reference AND we never diverged it.
  if (incoming === prev && !ownedRaw.has(prev)) return;
  const fam = t.fam;
  // §6b (R28): the diff's previous-arrangement baseline is the LANE VIEW —
  // optimistic rows must be visible to key matching so a landing carrying the
  // same key recycles their proxies. Raw `prev` keeps the identity/ownership
  // roles above; only matching reads the view.
  const prevView = fam?.opt === true ? optimisticView(t, prev) : prev;
  const nextArr = Array.isArray(incoming);
  // Plain stores notify inline AFTER the descent (child registrations feed
  // the fold diff's identity-preservation check); projections keep deferred
  // folds (downstream holds can form later in the flush).
  const eager = fam === null;
  const shallow = t.s === true;
  const old = t.v;
  adoptPB(t, incoming, eager);
  // Shallow adoption: records are slot values — sticky raw-mark the incoming
  // set (R41) and never descend; slot notification is the positional diff.
  if (shallow) markRawIngest(incoming);
  if (Array.isArray(prevView) !== nextArr) {
    if (eager) notifyFold(t, old, incoming);
    return;
  }
  if (nextArr) {
    const prevRows = prevView as any[];
    const nextRows = incoming as any[];
    // Fused array walk (eager mode): per-index notification rides the same
    // loop as the descent (descend first — targetsEqual needs the child's
    // re-registration, R9). Length, trailing removed indexes, and any other
    // unvisited node keys land in the counted sweep below.
    const nodes = eager ? t.n : null;
    let nodesHit = 0;
    if (keyFn && !shallow) {
      // Positional-prefix fast path (legacy keyedMatch-walk parity): while
      // rows key-match in place — the steady-state polling shape — descend
      // directly with zero staging. The prevByKey map is built only for the
      // misaligned remainder, and never at all on aligned ticks.
      const plen = prevRows.length;
      const nlen = nextRows.length;
      let i = 0;
      for (const end = Math.min(plen, nlen); i < end; i++) {
        const nv = nextRows[i];
        const pvRaw = prevRows[i];
        if (pvRaw !== nv && !(isWrappable(pvRaw) && isWrappable(nv) && keyFn(pvRaw) === keyFn(nv)))
          break; // misaligned: fall to the keyed remainder below
        // Identity skip inline (FINDING-1 guard), then descend the pair.
        if (
          (pvRaw !== nv || (nv !== null && typeof nv === "object" && ownedRaw.has(nv))) &&
          nv !== null &&
          typeof nv === "object"
        )
          descend(unwrapValue(pvRaw), nv, keyFn, fam, proj);
        if (nodes !== null) {
          const node = nodes[i];
          if (node !== undefined) {
            nodesHit++;
            notifyKeyValue(node, i as any, (old as any)[i], nv, old, incoming);
          }
        }
      }
      let prevByKey: Map<any, any> | null = null;
      for (; i < nextRows.length; i++) {
        const nv = nextRows[i];
        if (isWrappable(nv)) {
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
        if (nodes !== null) {
          const node = nodes[i];
          if (node !== undefined) {
            nodesHit++;
            notifyKeyDiff(node, i as any, old, incoming, false);
          }
        }
      }
    } else {
      const dlen = Math.min(prevRows.length, nextRows.length);
      const nlen = nextRows.length;
      for (let i = 0; i < nlen; i++) {
        if (!shallow && i < dlen) {
          const nv = nextRows[i];
          if (nv !== null && typeof nv === "object")
            descend(unwrapValue(prevRows[i]), nv, keyFn, fam, proj);
        }
        if (nodes !== null) {
          const node = nodes[i];
          if (node !== undefined) {
            nodesHit++;
            notifyKeyDiff(node, i as any, old, incoming, false);
          }
        }
      }
    }
    if (eager) {
      if (nodes !== null && nodesHit < t.nc) {
        for (const key of Reflect.ownKeys(nodes)) {
          // visited indexes are < nextRows.length; everything else sweeps
          const idx = typeof key === "string" ? +key : NaN;
          if (!(idx >= 0 && idx < nextRows.length))
            notifyKeyDiff(nodes[key as any], key, old, incoming, false);
        }
      }
      notifyFoldTail(t, old, incoming);
    }
    return;
  } else {
    // FUSED adoption walk (eager mode): one pass fetches each key's pair,
    // descends, then notifies its node inline — descend runs FIRST so the
    // child's re-registration is visible to targetsEqual (identity-preserved
    // slots must not notify, R9). This replaces the notifyFold re-walk that
    // doubled dbmon's diff cost. for-in covers own enumerable string keys
    // with no key-array allocation; symbols get a pass only when present.
    const nodes = eager ? t.n : null;
    let nodesHit = 0;
    // The per-key body is inlined on purpose (legacy applyStateFast parity:
    // an extracted helper costs a call per key on the hottest object-diff
    // site). Reference-identical values early-continue BEFORE any other
    // work — sound only with the ownership guard (FINDING-1: an owned
    // backing is setter-diverged and must still diff).
    for (const k in incoming) {
      const nv = (incoming as any)[k];
      const ov = (old as any)[k];
      const isObj = nv !== null && typeof nv === "object";
      if (
        ov === nv &&
        (!isObj || !ownedRaw.has(nv)) &&
        (nodes === null || nodes[k] === undefined || !hasAccessorFlag(nodes[k]))
      ) {
        if (nodes !== null && nodes[k] !== undefined) nodesHit++;
        continue;
      }
      if (isObj && !shallow) descend(unwrapValue((prevView as any)[k]), nv, keyFn, fam, proj);
      if (nodes !== null) {
        const node = nodes[k];
        if (node !== undefined) {
          nodesHit++;
          notifyKeyValue(node, k, ov, nv, old, incoming);
        }
      }
    }
    const syms = Object.getOwnPropertySymbols(incoming);
    for (let i = 0; i < syms.length; i++) {
      const k = syms[i];
      const nv = (incoming as any)[k];
      if (!shallow && nv !== null && typeof nv === "object")
        descend(unwrapValue((prevView as any)[k]), nv, keyFn, fam, proj);
      if (nodes !== null) {
        const node = nodes[k as any];
        if (node !== undefined) {
          nodesHit++;
          notifyKeyValue(node, k, (old as any)[k], nv, old, incoming);
        }
      }
    }
    if (eager) {
      // Deleted-key nodes (in the map but absent from incoming) — counted
      // fast-out: when every node was visited, skip the sweep entirely.
      if (nodes !== null && nodesHit < t.nc) {
        for (const key of Reflect.ownKeys(nodes)) {
          if (!hasOwnP.call(incoming, key))
            notifyKeyDiff(nodes[key as any], key, old, incoming, false);
        }
      }
      notifyFoldTail(t, old, incoming);
    }
    return;
  }
  if (eager) notifyFold(t, old, incoming);
}

const hasOwnP = Object.prototype.hasOwnProperty;

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
