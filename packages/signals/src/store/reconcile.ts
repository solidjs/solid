/**
 * Store — reconcile: the immutable-diff adoption channel (INTERNALS §3).
 *
 * Reconcile never merge-writes into backing objects: it adopts `incoming`
 * as the backing at every proxied level (an internal pointer swap at the
 * fold — no clones, no user-object mutation), value-notifies only where
 * nodes exist, and descends into a changed child pair only where a target
 * with nodes or the sticky descendants flag exists below (§6d: diff the
 * listened path, not every cell). Reference-equal unowned pairs skip
 * outright (an owned backing is setter-diverged and must diff).
 *
 * Keyed arrays: the aligned prefix is walked positionally; from the first
 * misalignment rows match by key (surviving rows keep their proxy
 * identity), unkeyed items fall back to position.
 */
import { isEqual } from "../core/core.js";
import {
  $OWNER,
  isOwned,
  lookupTarget,
  storeLookup,
  type StoreFamily,
  type StoreTarget
} from "./target.js";
import {
  adoptPB,
  bumpDeep,
  hasAccessorFlag,
  materializePB,
  notifyFold,
  notifyFoldTail,
  notifyKeyDiff,
  notifyKeyValue,
  optHooks,
  sameKey,
  targetsEqual,
  unwrapValue,
  userWriting
} from "./store.js";
import { $TARGET, isRawValue, isWrappable, markRawIngest, rawValuesUsed } from "./types.js";

type KeyFn = (item: any) => any;

export function reconcileState(
  value: any,
  state: any,
  key: string | KeyFn | null | undefined,
  replace = false
): void {
  if (state == null) throw new Error(__DEV__ ? "Cannot reconcile null or undefined state" : "");
  const t: StoreTarget | undefined = state?.[$TARGET];
  if (t === undefined || t.px !== state)
    throw new Error(__DEV__ ? "reconcile target is not a store proxy" : "");
  if (t.ovl) materializePB(t);
  const keyFn: KeyFn | null =
    key === null ? null : typeof key === "string" ? (item: any) => item?.[key] : (key as KeyFn);
  // A user's reconcile on an optimistic family (S4): not an adoption of
  // truth but an optimistic edit — the keyed diff is written into the draft
  // (a matched row keeps its proxy, its changed leaves become its guesses),
  // and the setter's exit turns the draft into guesses like any.
  if (userWriting() && t.fam?.opt === true) {
    optHooks!.reconcile(state, unwrapValue(value), keyFn);
    return;
  }
  // Replace-mode root handed another store's proxy: chain to it (§7b).
  if (replace && value !== state && value?.[$TARGET] !== undefined) {
    const prev = t.pb ?? t.v;
    if (prev === value) return; // already chained to this store
    adoptPB(t, value);
    return;
  }
  const incoming = unwrapValue(value);
  if (keyFn) {
    const prev = t.pb ?? t.v;
    const eq = keyFn(prev);
    if (eq !== undefined && !sameKey(keyFn(incoming), eq)) {
      if (!replace)
        throw new Error(__DEV__ ? "Cannot reconcile states with different identity" : "");
      // A different entity at the root: the old backing is disowned (wraps
      // fresh if re-handed) and the new one adopted whole.
      const out = t.pb ?? t.v;
      if (isOwned(out)) delete (out as any)[$OWNER];
      else (t.fam?.map ?? storeLookup).delete(out);
      adoptPB(t, incoming);
      return;
    }
  }
  applyAdopt(t, incoming, keyFn, replace);
}

/** Adopt `incoming` at `t` and notify its nodes — one leaf write per
 * changed observed key, the structural nodes once — descending into
 * changed child pairs that are proxied below. */
function applyAdopt(t: StoreTarget, incoming: any, keyFn: KeyFn | null, proj = false): void {
  const prev = t.pb ?? t.v;
  if (incoming === prev && !isOwned(prev)) return;
  const fam = t.fam;
  // Q-D: a landing on an optimistic family is reconciled against the VIEW
  // — key matching from the arrangement the guesses made (R28), so a row
  // the guess added keeps its proxy when the server returns it.
  const prevView = fam?.opt === true ? optHooks!.view(t, prev) : prev;
  const nextArr = Array.isArray(incoming);
  const shallow = t.s === true;
  const old = prev;
  adoptPB(t, incoming, false);
  if (shallow) markRawIngest(incoming);
  if (Array.isArray(prevView) !== nextArr) {
    notifyFold(t, old, incoming);
    return;
  }
  if (nextArr) {
    const prevRows = prevView as any[];
    const nextRows = incoming as any[];
    const nodes = t.n;
    let nodesHit = 0;
    if (keyFn && !shallow) {
      const plen = prevRows.length;
      const nlen = nextRows.length;
      let dkBumpedA = false;
      let i = 0;
      // Aligned prefix: same row (by reference or key) at the same index.
      for (const end = Math.min(plen, nlen); i < end; i++) {
        const nv = nextRows[i];
        const pvRaw = prevRows[i];
        if (
          pvRaw !== nv &&
          !(
            pvRaw !== null &&
            typeof pvRaw === "object" &&
            nv !== null &&
            typeof nv === "object" &&
            sameKey(keyFn(pvRaw), keyFn(nv))
          )
        )
          break; // misaligned: fall to the keyed remainder below
        if (
          (pvRaw !== nv || (nv !== null && typeof nv === "object" && isOwned(nv))) &&
          nv !== null &&
          typeof nv === "object"
        )
          descend(unwrapValue(pvRaw), nv, keyFn, fam, proj);
        if (
          t.dk !== null &&
          !dkBumpedA &&
          !(nv !== null && typeof nv === "object" ? targetsEqual(pvRaw, nv) : isEqual(pvRaw, nv))
        ) {
          bumpDeep(t);
          dkBumpedA = true;
        }
        if (nodes !== null) {
          const node = nodes[i];
          if (node !== undefined) {
            nodesHit++;
            notifyKeyValue(node, i as any, (old as any)[i], nv, old, incoming);
          }
        }
      }
      if (t.dk !== null && !dkBumpedA && i < nextRows.length) bumpDeep(t);
      const structStart = i; // misalignment point (== nlen on aligned ticks)
      let prevByKey: Map<any, any> | null = null;
      for (; i < nextRows.length; i++) {
        const nv = nextRows[i];
        if (nv !== null && typeof nv === "object") {
          const nk = keyFn(nv);
          let pv: any;
          if (nk !== undefined) {
            if (prevByKey === null) {
              prevByKey = new Map();
              for (let j = structStart; j < prevRows.length; j++) {
                const p = unwrapValue(prevRows[j]);
                if (p !== null && typeof p === "object") {
                  const pk = keyFn(p);
                  if (pk === undefined) continue;
                  const existing = prevByKey.get(pk);
                  if (existing === undefined) prevByKey.set(pk, j);
                  else if (Array.isArray(existing)) existing.push(j);
                  else prevByKey.set(pk, [existing, j]);
                }
              }
            }
            const m = prevByKey.get(nk);
            if (m === undefined) pv = undefined;
            else if (Array.isArray(m)) {
              pv = unwrapValue(prevRows[m.shift()!]);
              if (m.length === 1) prevByKey.set(nk, m[0]);
            } else {
              pv = unwrapValue(prevRows[m]);
              prevByKey.delete(nk);
            }
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
      let dkBumpedP = false;
      for (let i = 0; i < nlen; i++) {
        const nvP = nextRows[i];
        if (!shallow && i < dlen && nvP !== null && typeof nvP === "object")
          descend(unwrapValue(prevRows[i]), nvP, keyFn, fam, proj);
        if (
          t.dk !== null &&
          !dkBumpedP &&
          !(nvP !== null && typeof nvP === "object"
            ? targetsEqual(prevRows[i], nvP)
            : isEqual(prevRows[i], nvP))
        ) {
          bumpDeep(t);
          dkBumpedP = true;
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
    // Indices past the new length (and `length` itself) still have nodes.
    if (nodes !== null && nodesHit < t.nc) {
      for (const key of Reflect.ownKeys(nodes)) {
        const idx = typeof key === "string" ? +key : NaN;
        if (!(idx >= 0 && idx < nextRows.length))
          notifyKeyDiff(nodes[key as any], key, old, incoming, false);
      }
    }
    notifyFoldTail(t, old, incoming);
    return;
  }
  const nodes = t.n;
  let nodesHit = 0;
  let dkBumped = false;
  for (const k in incoming) {
    const nv = (incoming as any)[k];
    const ov = (old as any)[k];
    const isObj = nv !== null && typeof nv === "object";
    if (
      ov === nv &&
      (!isObj || !isOwned(nv)) &&
      (nodes === null || nodes[k] === undefined || !hasAccessorFlag(nodes[k]))
    ) {
      if (nodes !== null && nodes[k] !== undefined) nodesHit++;
      continue;
    }
    if (isObj && !shallow) descend(unwrapValue((prevView as any)[k]), nv, keyFn, fam, proj);
    if (t.dk !== null && !dkBumped && !(isObj ? targetsEqual(ov, nv) : isEqual(ov, nv))) {
      bumpDeep(t);
      dkBumped = true;
    }
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
    if (k === $OWNER) continue;
    const nv = (incoming as any)[k];
    if (!shallow && nv !== null && typeof nv === "object")
      descend(unwrapValue((old as any)[k]), nv, keyFn, fam, proj);
    if (nodes !== null) {
      const node = nodes[k as any];
      if (node !== undefined) {
        nodesHit++;
        notifyKeyValue(node, k, (old as any)[k], nv, old, incoming);
      }
    }
  }
  // Keys the incoming object no longer has still have nodes.
  if (nodes !== null && nodesHit < t.nc) {
    for (const key of Reflect.ownKeys(nodes)) {
      if (!hasOwnP.call(incoming, key)) notifyKeyDiff(nodes[key as any], key, old, incoming, false);
    }
  }
  notifyFoldTail(t, old, incoming);
}

const hasOwnP = Object.prototype.hasOwnProperty;

/** Descend into a changed child pair — only where something is proxied
 * below (§6d), never into a raw-marked leaf, never across array/object or a
 * key mismatch (that is a replacement, handled by the parent's slot). */
function descend(
  pv: any,
  nv: any,
  keyFn: KeyFn | null,
  fam: StoreFamily | null,
  proj = false
): void {
  if (pv === null || typeof pv !== "object" || nv === null || typeof nv !== "object") return;
  const ct = lookupTarget(pv, fam);
  if (ct === undefined) return; // nothing proxied below this pair
  if (!isWrappable(nv)) return;
  if (rawValuesUsed && isRawValue(nv)) return;
  nv = unwrapValue(nv);
  if (Array.isArray(pv) !== Array.isArray(nv)) return;
  if (keyFn) {
    const pk = keyFn(pv);
    const nk = keyFn(nv);
    if (pk !== undefined && nk !== undefined && !sameKey(pk, nk)) return;
  }
  if (!proj && keyFn !== null && !ct.d) return;
  applyAdopt(ct, nv, keyFn, proj);
}
