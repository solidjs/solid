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
import { isEqual } from "../../core/index.js";
import type { RowOps } from "./patch.js";
// Patch-channel emission rides installed hooks (patch-hooks.ts) — this
// module must never import patch.js at runtime (patch.js imports
// emitSetterRowOps from here, and the hooks are what keep the channel
// tree-shakeable for non-patch apps). All calls are `t.pc`-guarded.
import { patchHooks, rowHooks } from "./patch-hooks.js";
import {
  $PROXY,
  $TARGET,
  isRawValue,
  isWrappable,
  markRawIngest,
  rawValuesUsed
} from "../store.js";
import {
  materializePB,
  adoptPB,
  hasAccessorFlag,
  notifyFold,
  notifyFoldTail,
  bumpDeep,
  notifyKeyDiff,
  targetsEqual,
  notifyKeyValue,
  unwrapValue,
  targetIsPlain,
  targetKeysPlain
} from "./store.js";
import {
  ownedRaw,
  storeNextLookup,
  type StoreNextFamily,
  type StoreNextTarget,
  optHooks
} from "./target.js";
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
  // Reconcile's diff walks need a REAL pending container — a prototype
  // overlay (#3044) materializes to the clone path first (edge: reconcile
  // inside a setter that already wrote this target).
  if (t.ovl) materializePB(t);
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
    if (eq !== undefined && !sameKey(keyFn(incoming), eq)) {
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
    optHooks!.applyTentative(t, incoming, keyFn);
    return;
  }
  applyAdopt(t, incoming, keyFn, replace);
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
  const prevView = fam?.opt === true ? optHooks!.optimisticView(t, prev) : prev;
  const nextArr = Array.isArray(incoming);
  // Plain stores notify inline AFTER the descent (child registrations feed
  // the fold diff's identity-preservation check); projections keep deferred
  // folds (downstream holds can form later in the flush).
  const eager = fam === null;
  const shallow = t.s === true;
  const old = t.v;
  adoptPB(t, incoming, eager);
  // Patch channel (adoption site): this record transitioned — queue its
  // patches with the pre-adopt prev. No bubbling walk: the adoption walk
  // visits parents before children, so ancestors emitted already. EAGER
  // only — family targets' visibility moment is their fold commit
  // (drainFolds emits there; emitting here too would double-fire).
  if (patchHooks !== null && eager && t.pc !== null && t.pc.p !== null) {
    // Accessor demotion at the ADOPTION seam is DEV-ONLY (prod principle:
    // explicitly-odd input must not cost correct-input prod — the
    // per-adoption scan was ~12% of dbmon's tick since adoptPB resets the
    // verdict every adoption). Dev demotes AND warns; prod emits directly,
    // so a getter adoptee's OUTSIDE deps (signals) won't re-apply in prod —
    // caught loudly during development instead. Registration-time admission
    // (patchableRaw) keeps its full one-time scan in both modes.
    if (targetKeysPlain(t)) {
      patchHooks.emitPatchLocal(t, incoming, old);
    } else {
      if (__DEV__)
        console.warn(
          "A reconcile adopted an object whose getters shadow keys read by " +
            "this record's compiled patches — the patches are demoted to " +
            "tracked effects so the getters' reactive dependencies apply."
        );
      patchHooks.demoteToEffects(t);
    }
  }
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
      let dkBumpedA = false;
      let i = 0;
      for (const end = Math.min(plen, nlen); i < end; i++) {
        const nv = nextRows[i];
        const pvRaw = prevRows[i];
        // Routing heuristic only (aligned vs keyed remainder) — both routes
        // notify identically and descend() is the one authoritative
        // validator, so bare typeof gates suffice here; full isWrappable
        // per row was the walk's dominant residual cost.
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
        // Identity skip inline (FINDING-1 guard), then descend the pair.
        if (
          (pvRaw !== nv || (nv !== null && typeof nv === "object" && ownedRaw.has(nv))) &&
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
        // typeof gates route; descend validates (same contract as the prefix).
        if (nv !== null && typeof nv === "object") {
          const nk = keyFn(nv);
          let pv: any;
          if (nk !== undefined) {
            if (prevByKey === null) {
              // Occurrence-aware (re-audit 2, P1-5): duplicate keys queue
              // their prev INDICES (rows can themselves be arrays, so index
              // queues are the unambiguous encoding — same as buildRowOps)
              // and each is consumed ONCE. First-wins would adopt two next
              // rows into the SAME prev target while row ops retain two
              // separate DOM rows (the second one stale).
              prevByKey = new Map();
              // From structStart, not 0 (re-audit 3, P1-2): prefix-aligned
              // rows already adopted their incoming counterparts — re-offering
              // them here let a duplicate key adopt a prefix row AGAIN while
              // row ops (which correctly window from structStart) retained
              // the later occurrence's DOM row against a never-adopted target.
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
      // Row ops (PR-B): emit structural ops ONLY when structure changed —
      // aligned value ticks pay nothing. Built after the walk so retained
      // rows' value patches queue first (adds bind at op-apply).
      if (
        rowHooks !== null &&
        t.pc !== null &&
        t.pc.ro !== null &&
        (structStart < nlen || plen !== nlen)
      )
        buildAndEmitRowOps(t, prevRows, nextRows, structStart, keyFn);
    } else {
      const dlen = Math.min(prevRows.length, nextRows.length);
      const nlen = nextRows.length;
      let dkBumpedP = false;
      const sp = rowHooks !== null && t.pc !== null ? t.pc.sp : null;
      // Row ops for shallow/positional lists: track the key-aligned prefix
      // (keyed) so aligned value ticks emit nothing; keyless lists emit only
      // on length change (append/truncate). Slot-patch consumers need the
      // alignment tracking too (aligned = value tick, misaligned = ops).
      const ro = rowHooks !== null && t.pc !== null ? t.pc.ro : null;
      let keyAligned = keyFn !== null && (ro !== null || sp !== null);
      let keyPrefix = 0;
      for (let i = 0; i < nlen; i++) {
        const nvP = nextRows[i];
        if (keyAligned && i < dlen) {
          const pvK = prevRows[i];
          if (
            pvK !== null &&
            typeof pvK === "object" &&
            nvP !== null &&
            typeof nvP === "object" &&
            // SameValueZero (self-sweep): strict === here broke slot
            // alignment on NaN keys while buildRowOps retained the row —
            // retained DOM with suppressed value ticks (the round-1 NaN
            // staleness, in the shallow branch).
            sameKey(keyFn!(pvK), keyFn!(nvP))
          )
            keyPrefix++;
          else keyAligned = false;
        }
        // Slot-patch dispatch (shallow): a KEY-ALIGNED slot whose value was
        // replaced by reference is a value tick — emit through the queue.
        // Misaligned/appended slots are STRUCTURE (row ops rebuild or move
        // them; new rows initial-apply at bind), so they emit nothing here.
        // Keyless positional lists treat same-index replacement as the value
        // tick for indices below the common length.
        // `i < dlen` is load-bearing for BOTH modes: an appended position
        // past a fully-aligned prefix (vacuously aligned when prev is empty)
        // has no previous slot — emitting a slot tick for it races the row
        // ops that CREATE the row (the slot queue applies first, indexing a
        // row that does not exist yet). Equivalence-matrix finding:
        // clear-then-refill and pure appends crashed the driver.
        if (sp !== null && i < dlen && (keyFn === null || keyAligned)) {
          const pvS = prevRows[i];
          if (pvS !== nvP) rowHooks!.emitSlotPatch(t, i, nvP, pvS);
        }
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
      if (ro !== null) {
        const plen = prevRows.length;
        if (keyFn !== null) {
          if (keyPrefix < nlen || plen !== nlen)
            buildAndEmitRowOps(t, prevRows, nextRows, keyPrefix, keyFn);
        } else if (plen !== nlen) {
          buildAndEmitRowOps(t, prevRows, nextRows, dlen, null);
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
    // PROTOTYPE compiled-patch fast path: a pure-patch record (no nodes,
    // no presence/key-set/deep subscribers, no family) adopts and hands the
    // (next, prev) pair to its compiled patch — no per-key walk at all.
    if (
      t.pc !== null &&
      t.pc.p !== null &&
      eager &&
      t.n === null &&
      t.h === null &&
      t.k === null &&
      t.dk === null &&
      fam === null
    ) {
      // Adoption already ran at applyAdopt entry; emission was queued there.
      return;
    }
    const nodes = eager ? t.n : null;
    let nodesHit = 0;
    let dkBumped = false;
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
      // Deep-witness (dk): value changes must notify even with NO per-key
      // node — deep() subscribes one node per record. Checked after descend
      // so in-place adoptions (same logical slot) don't bump; child records
      // carry their own witness. One flag + null check when unused.
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

/** Setter-channel row ops (the fold site calls this for array targets with
 * ops consumers): structural mutation through the setter — push/splice/index
 * assignment/permutation — is a visibility transition for the list container
 * just like a reconcile walk, and drivers consuming registerRowOps must see
 * it. Setter mutations move the SAME row objects around, so RAW IDENTITY is
 * the key. Aligned arrays (value-only folds) emit nothing. */
const identityKey = (r: any) => unwrapValue(r);

/** Key equality for EVERY key comparison in this module (re-audit 2, P1-5):
 * SameValueZero, matching the Map-based matchers (buildRowOps, the adoption
 * window) — NaN keys are equal to themselves, so aligned NaN rows stay
 * aligned in the prefix walk instead of forever misaligning. Adoption and
 * row ops MUST agree on key equality or retained DOM rows go stale. */
export function sameKey(a: any, b: any): boolean {
  return a === b || (a !== a && b !== b);
}
export function emitSetterRowOps(t: StoreNextTarget, prevRows: any[], nextRows: any[]): void {
  const ops = buildIdentityRowOps(prevRows, nextRows);
  if (ops !== null) rowHooks!.emitRowOps(t, nextRows, ops);
}

/** Identity-keyed structural diff, returned rather than emitted: shared by
 * the setter channel (regular queue) and the OPTIMISTIC write channel (lane
 * queue) — same retention semantics, different dispatch timing. Returns
 * null when the lists are identity-aligned (no structure changed). */
export function buildIdentityRowOps(prevRows: any[], nextRows: any[]): RowOps | null {
  let p = 0;
  const min = prevRows.length < nextRows.length ? prevRows.length : nextRows.length;
  while (p < min && unwrapValue(prevRows[p]) === unwrapValue(nextRows[p])) p++;
  if (p === prevRows.length && p === nextRows.length) return null;
  return buildRowOps(prevRows, nextRows, p, identityKey);
}

/** Shared row-ops builder (keyed deep branch + shallow/positional branch):
 * key-matches the misaligned window into { prefix, sources, removed }.
 * `keyFn === null` degrades to positional ops (append/truncate only). */
function buildAndEmitRowOps(
  t: StoreNextTarget,
  prevRows: any[],
  nextRows: any[],
  structStart: number,
  keyFn: KeyFn | null
): void {
  rowHooks!.emitRowOps(t, nextRows, buildRowOps(prevRows, nextRows, structStart, keyFn));
}

function buildRowOps(
  prevRows: any[],
  nextRows: any[],
  structStart: number,
  keyFn: KeyFn | null
): RowOps {
  const plen = prevRows.length;
  const nlen = nextRows.length;
  const sources = new Array(nlen - structStart);
  // Occurrence-aware matching (re-audit): duplicate keys queue their old
  // indices and each is consumed ONCE — first-wins reuse would hand the same
  // source (and its one DOM row) to multiple next positions. The no-dup fast
  // shape stays a bare number; collisions upgrade to a queue.
  let oldIndexByKey: Map<any, number | number[]> | null = null;
  if (keyFn !== null && structStart < plen) {
    oldIndexByKey = new Map();
    for (let j = structStart; j < plen; j++) {
      const p = unwrapValue(prevRows[j]);
      if (p !== null && typeof p === "object") {
        const pk = keyFn(p);
        if (pk === undefined) continue;
        const existing = oldIndexByKey.get(pk);
        if (existing === undefined) oldIndexByKey.set(pk, j);
        else if (Array.isArray(existing)) existing.push(j);
        else oldIndexByKey.set(pk, [existing, j]);
      }
    }
  }
  const consumed = oldIndexByKey !== null ? new Set<number>() : null;
  for (let k = structStart; k < nlen; k++) {
    const nv = nextRows[k];
    let oldIdx = -1;
    if (nv !== null && typeof nv === "object" && oldIndexByKey !== null) {
      const nk = keyFn!(nv);
      if (nk !== undefined) {
        const m = oldIndexByKey.get(nk);
        if (m !== undefined) {
          if (Array.isArray(m)) {
            oldIdx = m.shift()!;
            if (m.length === 1) oldIndexByKey.set(nk, m[0]);
          } else {
            oldIdx = m;
            oldIndexByKey.delete(nk);
          }
          consumed!.add(oldIdx);
        }
      }
    }
    sources[k - structStart] = oldIdx;
  }
  const removed: any[] = [];
  for (let j = structStart; j < plen; j++) {
    if (consumed === null || !consumed.has(j)) removed.push(unwrapValue(prevRows[j]));
  }
  return { prefix: structStart, sources, removed };
}

function descend(
  pv: any,
  nv: any,
  keyFn: KeyFn | null,
  fam: StoreNextFamily | null,
  proj = false
): void {
  if (pv === null || typeof pv !== "object" || nv === null || typeof nv !== "object") return;
  // Lookup FIRST: a hit implies pv was wrappable and never raw-marked (only
  // wrappables acquire targets; rawValues never wrap) — one WeakMap get
  // replaces isWrappable(pv) + isRawValue(pv), and a miss prunes untracked
  // subtrees before any further checks.
  const ct = (fam?.map ?? storeNextLookup).get(pv);
  if (ct === undefined) return; // nothing proxied below this pair
  // The NEW side still validates fully: a frozen/platform/markRaw'd incoming
  // value is a leaf for reconcile — replaced by reference, never recursed
  // into (R42); the parent's slot notification covers the change.
  if (!isWrappable(nv)) return;
  if (rawValuesUsed && isRawValue(nv)) return;
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
    // SameValueZero (re-audit 2, P1-5): NaN keys are self-equal — strict
    // inequality detached every NaN-keyed slot on every tick while the
    // Map-based row-ops matcher retained its DOM row (stale forever).
    if (pk !== undefined && nk !== undefined && !sameKey(pk, nk)) return;
  }
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
