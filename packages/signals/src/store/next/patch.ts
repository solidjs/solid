/**
 * PR-A: the patch channel (DESIGN-PATCH-CHANNEL.md).
 *
 * Compiled patch functions — per-record compare-and-write consumers —
 * dispatched by the store's visibility transitions instead of render
 * effects. This module owns registration, the per-flush apply queue
 * (effect-phase timing, §2b), the owned-prev rule (§2c), and dispatch
 * bubbling (§4b). Emission calls live at the four visibility-transition
 * sites (adoption walk, setter notify, fold commit, override lifecycle)
 * and are gated on registration, so unpatched stores pay a null check.
 *
 * Bubbling contract: a targeted nested write reaches ancestor patches as a
 * FORCED re-apply — the third `force` argument makes every compiled compare
 * pass, so the ancestor rewrites its bound fields from its current backing
 * (idempotent, and prev-free: an ancestor's pre-state is not reconstructible
 * after in-place folds). Compiled bodies therefore have the signature
 * `(next, prev, force?)`.
 *
 * Tree-shaking: core never imports this module; stores without patches
 * never schedule the queue.
 */
import {
  CONFIG_OWNED_WRITE,
  EFFECT_RENDER,
  EFFECT_USER,
  NOT_PENDING,
  STATUS_ERROR
} from "../../core/constants.js";
import { ext, read as readSignal, setSignal, signal } from "../../core/core.js";
import { StatusError } from "../../core/error.js";
import { haltReactivity } from "../../core/scheduler.js";
import { getOwner, isDisposed } from "../../core/owner.js";
import {
  activeTransition,
  globalQueue,
  GlobalQueue,
  setPatchCommitHook,
  type Transition
} from "../../core/scheduler.js";
import type { Owner } from "../../core/types.js";
import { $TARGET, isWrappable } from "../store.js";
import { markDescendants, ownedRaw, type StoreNextTarget } from "./target.js";
import { installPatchHooks, installRowHooks, wrapRecordHook } from "./patch-hooks.js";
import { optHooks } from "./target.js";
// One-way: reconcile emits through the hooks (never imports this module),
// so pulling its setter-channel emitter here creates no cycle.
import { emitSetterRowOps } from "./reconcile.js";
// Cycle with store.js is benign (established pattern above): both resolve at
// call time, long after module initialization.
import { deepPathsPlain, heldMaskView, targetIsPlain, targetKeysPlain } from "./store.js";
import type { DeepNode } from "./target.js";

import { InvariantHooks } from "../../core/invariants.js";
import { assertInvariant } from "../../core/dev.js";
import { runWithOwner, untrack } from "../../core/core.js";
import { createRenderEffect } from "../../signals.js";
import { createRoot } from "../../core/owner.js";
// Cycle with store.js is benign: pcOf is only called at registration time,
// long after both modules initialize.
import { pcOf } from "./store.js";

export type PatchFn = (next: any, prev: any, force?: boolean) => void;

interface PatchEntry {
  fn: PatchFn;
  owner: Owner | null;
  /** Unbound mark: dispatch snapshots skip severed consumers. */
  u?: boolean;
  /** Keys recorded (adoption demotion probes); undefined = record at the
   * next drain apply. */
  k?: boolean;
}

// Per-flush apply queue. Bubbled (forced) emissions resolve `next` LAZILY at
// drain time from the live target: privatization can clone an ancestor's
// backing between emission and drain, so a captured reference goes stale.
interface QueuedApply {
  list: PatchEntry[];
  next: any;
  prev: any;
  force: boolean;
  /** When set, `next` resolves at drain as `t.pb ?? t.v` (bubbles). */
  t: StoreNextTarget | null;
  /** Coalescing + recording backref (re-audits 3/6): set for stamped SELF
   * entries so the drain can clear the channel's stamps (retention), record
   * first-apply read sets (ak), and resolve the VALUE consumer list LIVE
   * (re-audit 7, P2-9/P1-5 dual: value applications are absolute, so they
   * go to whoever is registered at drain — a list recreated while the entry
   * was held or merged must not be missed). */
  pc?: {
    qa: unknown;
    qe: unknown;
    ak: PropertyKey[] | null;
    p: object[] | null;
  };
  /** Structural row ops (re-audit 6): entries queue the LIVE consumer list
   * plus the ops payload — cloned wrappers survived unbinding, so stale
   * row callbacks fired after a subject switch. */
  ops?: RowOps | null;
  /** Slot-tick payload index (same live-list rationale as `ops`). */
  si?: number;
}
let queue: QueuedApply[] | null = null;
let scheduled = false;

function drainApplyQueue(): void {
  // Settle-time fallback for optimistic emissions (a reverting flush may
  // have no active lanes left to run the lane-slot drain).
  drainOptimistic();
  const q = queue;
  queue = null;
  scheduled = false;
  if (q === null) return;
  // Per-entry isolation: one throwing patch must not abort its siblings
  // (effect parity — each effect isolates its failure). A throwing patch
  // routes through its REGISTERING OWNER's queue chain exactly like a
  // render-effect error (§2b): an Errored boundary above the row collects
  // it (source = the owner, error read via owner._x?._error). Unhandled errors
  // rethrow after the drain so they still surface.
  let firstError: unknown = UNSET;
  for (let i = 0; i < q.length; i++) {
    const { prev, force, t } = q[i];
    const next = t !== null ? (force ? forcedNext(t) : (t.pb ?? t.v)) : q[i].next;
    if (q[i].ops !== undefined || q[i].si !== undefined)
      firstError = applyStructural(q[i], next, firstError);
  }
  if (firstError !== UNSET) {
    // Unhandled patch errors HALT like unhandled effect errors (re-audit 2,
    // P1-4): app state is undefined past an unboundaried throw.
    haltReactivity(firstError);
    throw firstError;
  }
}

/** Forced-apply `next` resolution. Deep-path channels read through the
 * PROXY (re-audit 7): eager adoption swaps a child's backing without
 * rewriting ancestor raw slots (proxy readers resolve children through
 * their targets), so a raw parent walk would read the PRE-ADOPTION child.
 * The drain runs untracked — proxy reads resolve fresh without edges.
 * Depth-1 channels keep the raw fast path. */
function forcedNext(t: StoreNextTarget): any {
  return t.pc !== null && t.pc.dp !== null ? t.px : (t.pb ?? t.v);
}

/** Row-ops/slot-tick dispatch over the EMISSION-TIME snapshot (re-audit 7,
 * P1-5): baseline-relative structural work must reach exactly the consumers
 * registered when it was computed — late registrants initialized from
 * current state. Unbinds between emission and drain sever through the
 * shared entries' `u` marks (re-audit 6). Same per-entry isolation and
 * error routing as value patches. */
function applyStructural(item: QueuedApply, next: any, firstError: unknown): unknown {
  const snap = item.list as unknown as { fn: Function; owner: Owner | null; u?: boolean }[];
  const len = snap.length;
  for (let j = 0; j < len; j++) {
    const entry = snap[j];
    if (entry === undefined || entry.u === true) continue;
    if (entry.owner !== null && isDisposed(entry.owner)) continue;
    try {
      if (item.si !== undefined) entry.fn(item.si, next, item.prev);
      else entry.fn(next, item.ops);
    } catch (err) {
      let handled = false;
      const owner = entry.owner as any;
      if (owner !== null) {
        let source = owner;
        while (source !== null && source._fn === undefined) source = source._parent;
        source ??= owner;
        const statusErr = new StatusError(source, err);
        ext(source)._error = statusErr;
        source._statusFlags = (source._statusFlags ?? 0) | STATUS_ERROR;
        handled = owner._queue.notify(source, STATUS_ERROR, STATUS_ERROR, statusErr);
      }
      if (!handled && firstError === UNSET) firstError = err;
    }
  }
  return firstError;
}

const UNSET: unique symbol = Symbol();
/** Sentinel: applyEntries resolves prev per entry (node delivery). */
const PER_ENTRY_PREV: unique symbol = Symbol();

/** ONE callback/error primitive for every drain (normal, transition-held,
 * optimistic): per-entry isolation — a throwing patch must not abort its
 * siblings (effect parity) — and failures route through the REGISTERING
 * OWNER's queue chain exactly like a render-effect error (§2b): an Errored
 * boundary above the row collects it. Unhandled errors are aggregated by the
 * caller (first one rethrows after its drain completes). */
function applyEntries(
  list: PatchEntry[],
  next: any,
  prev: any,
  force: boolean,
  firstError: unknown,
  pc?: { ak: PropertyKey[] | null }
): unknown {
  // SNAPSHOT multi-consumer lists (re-audit 5, P1-3): a callback can dispose
  // a sibling's owner, whose unbind SPLICES this same array mid-iteration —
  // index-walking the live array skips the shifted consumer. The dominant
  // single-consumer case pays nothing; unbound entries are marked so a
  // snapshot never applies a consumer severed by an earlier callback.
  const snap = list.length > 1 ? list.slice() : list;
  // FIXED WINDOW (re-audit 6, P2-4): the single-consumer fast path aliases
  // the live list — a callback registering ANOTHER patch mid-dispatch must
  // not run it in this same drain (it just received its initial apply).
  const len = snap.length;
  for (let j = 0; j < len; j++) {
    const entry = snap[j];
    if (entry === undefined || entry.u === true) continue;
    // Disposed owners drop their patches (the row unmounted mid-flush).
    if (entry.owner !== null && isDisposed(entry.owner)) continue;
    try {
      // First-apply key recording (re-audit 6): entries registered without a
      // recorded read set (hydration skips the initial apply) record here —
      // one proxied apply per entry lifetime keeps the adoption demotion
      // gate prod-sound for them too.
      if (pc !== undefined && entry.k !== true && next !== null && typeof next === "object") {
        entry.k = true;
        ensureOwnedKeys(pc as any); // interned manifests are copy-on-write
        const ak = (pc.ak ??= []);
        const rec = new Proxy(next as object, {
          get(o, key, r) {
            if (ak.indexOf(key) === -1) ak.push(key);
            return Reflect.get(o, key, r);
          }
        });
        entry.fn(rec, prev === PER_ENTRY_PREV ? (entry as any).pv : prev, force);
        if (prev === PER_ENTRY_PREV) {
          const px = (pc as any).t?.px;
          (entry as any).pv = next === px ? untrack(() => manifestSnapshot(pc as any, next)) : next;
        }
      } else {
        const ep = prev === PER_ENTRY_PREV ? (entry as any).pv : prev;
        // A consumer whose baseline never materialized (projection backing
        // absent at registration) takes its first delivery FORCED — there
        // is nothing to compare against, and compiled bodies only tolerate
        // an undefined prev under force.
        if (ep == null && prev === PER_ENTRY_PREV) entry.fn(next, undefined, true);
        else entry.fn(next, ep, force);
        if (prev === PER_ENTRY_PREV) {
          const px = (pc as any).t?.px;
          (entry as any).pv = next === px ? untrack(() => manifestSnapshot(pc as any, next)) : next;
        }
      }
    } catch (err) {
      let handled = false;
      const owner = entry.owner as any;
      if (owner !== null) {
        // Route through the nearest COMPUTED ancestor (re-audit 2, P1-4):
        // <Errored>.reset() recomputes its sources, and a plain owner (the
        // list driver's listOwner) is not recomputable — the component/memo
        // scope above it is, and recomputing it rebuilds the rows, exactly
        // what reset means for a throwing render effect.
        let source = owner;
        while (source !== null && source._fn === undefined) source = source._parent;
        source ??= owner;
        const statusErr = new StatusError(source, err);
        ext(source)._error = statusErr;
        source._statusFlags = (source._statusFlags ?? 0) | STATUS_ERROR;
        handled = owner._queue.notify(source, STATUS_ERROR, STATUS_ERROR, statusErr);
      }
      if ((globalThis as any).__DBG__)
        console.log("[route]", "handled:", handled, "hasOwner:", entry.owner !== null);
      if (!handled && firstError === UNSET) firstError = err;
    }
  }
  return firstError;
}

// Transition-stamped emissions (§2b, "the walk is not the visibility moment
// inside a transition"): entries stash DIRECTLY on their transition
// (`_heldPatches`) and release into the live queue when THAT batch commits
// (patchCommitHook). Reverted transitions never commit — their stash drops
// with the transition object, no revert bookkeeping. The field (rather than
// a WeakMap) keeps the every-flush commit-hook check to one property read;
// the ambient batch never stashes.
let commitHookInstalled = false;

function releaseBatch(batch: Transition): void {
  const held = (batch as any)._heldPatches as QueuedApply[] | undefined;
  if (held === undefined) return;
  (batch as any)._heldPatches = undefined;
  for (let i = 0; i < held.length; i++) pushLive(held[i]);
}

function pushLive(item: QueuedApply): void {
  (queue ??= []).push(item);
  if (!scheduled) {
    scheduled = true;
    globalQueue.enqueue(EFFECT_RENDER, drainApplyQueue);
  }
}

function push(item: QueuedApply): void {
  const tx = activeTransition;
  if (tx !== null) {
    (((tx as any)._heldPatches ??= []) as QueuedApply[]).push(item);
    return;
  }
  pushLive(item);
}

/** Self-entry push with SAME-BATCH COALESCING (re-audit 2/3): a record's
 * later non-forced emission into the same container UPDATES the queued
 * entry in place — `next` takes the newest capture (adoption swaps the
 * backing object per emission; dropping the later one applied STALE state),
 * `prev` keeps the batch's earliest (effect semantics: one application per
 * batch spanning the whole window). The entry's consumer list is the live
 * pc.p array, so mid-batch registrants ride the single application. Forced
 * entries and row/slot ops never coalesce; the drain clears the stamps so a
 * quiet record retains nothing from its last batch. */

/** Shallow clone for the owned-prev rule (§2c): owned backings fold values
 * INTO the same raw at commit, so a queued prev must be snapshotted. */
function clonePrev(prev: any): any {
  return Array.isArray(prev) ? prev.slice() : { ...prev };
}

/**
 * Emit a record's visibility transition. Callers gate on `hasPatches()` and
 * `t.d` cheaply; this function re-checks and walks ancestors (§4b).
 */
export function emitPatch(t: StoreNextTarget, next: any, prev: any): void {
  const pc = t.pc as any;
  if (pc !== null) {
    bumpDelivery(pc);
    pc.np = next;
    pc.npb = pc.bc;
  }
  emitPatchAncestors(t);
}

/** Ancestor bubble, standalone (re-audit 7): targeted reconciles emit
 * walk-locally for the walked subtree but ancestors' compiled bodies can
 * read INTO it through nested chains — the walk root must bubble exactly
 * like a nested setter write does. Forced entries COALESCE per container
 * (re-audit 8, P2-7): N nested writes in one batch force ONE ancestor
 * re-apply, effect parity; the drain clears the stamp. */
export function emitPatchAncestors(t: StoreNextTarget): void {
  let u = t.u;
  while (u !== null) {
    if (u.pc !== null) bumpDelivery(u.pc);
    u = u.u;
  }
}

/** Tentative (optimistic) ancestor bubble (re-audit 8, P1-3): in-flight
 * visibility rides the LANE queue — and the SAME forced entries are staged
 * on the transaction for settle (revert restores committed truth to
 * ancestor expressions; landings show the landed state). Both resolve
 * live at their drains. */
export function emitPatchAncestorsOptimistic(t: StoreNextTarget, _tx: unknown): void {
  let u = t.u;
  while (u !== null) {
    if (u.pc !== null) bumpDeliveryOptimistic(u.pc);
    u = u.u;
  }
}

/** Emission for sites that already stand at the record with both sides in
 * hand and have already handled ancestors (the adoption walk descends —
 * parents were visited first), so no bubbling walk. */
export function emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void {
  const pc = t.pc as any;
  if (pc === null) return;
  bumpDelivery(pc);
  // Payload fast path (raw-read thesis): the emission's own state rides
  // the channel — deliveries read it RAW instead of proxy-resolving.
  // bc-tagged: a later bump (including post-revert) invalidates it.
  pc.np = next;
  pc.npb = pc.bc;
}

/** Optimistic-channel emission: overrides are visible THIS flush while the
 * transaction is in flight — that is what optimism means. These ride a
 * dedicated queue drained at LANE-EFFECT timing (the regular effect queues
 * are stashed by an in-flight action), with the regular drain as the
 * settle-time fallback. `next === null` = forced re-apply from the live
 * target (the revert shape: committed truth back onto the DOM). */
let optQueue: QueuedApply[] | null = null;

function drainOptimistic(): void {
  const q = optQueue;
  optQueue = null;
  if (q === null) return;
  // Same isolation/routing primitive as the normal drain (re-audit blocker
  // 5): one throwing optimistic patch must not abort its siblings, and it
  // must reach the registering owner's Errored boundary.
  let firstError: unknown = UNSET;
  for (let i = 0; i < q.length; i++) {
    const { prev, force, t } = q[i];
    const next = t !== null ? (force ? forcedNext(t) : (t.pb ?? t.v)) : q[i].next;
    if (q[i].ops !== undefined || q[i].si !== undefined)
      firstError = applyStructural(q[i], next, firstError);
  }
  if (firstError !== UNSET) {
    haltReactivity(firstError);
    throw firstError;
  }
}

export function emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void {
  if (t.pc !== null) bumpDeliveryOptimistic(t.pc);
}

/** Row-ops emission at OPTIMISTIC (lane) timing: user drafts on an
 * optimistic family must show structure IN FLIGHT — bypassing the
 * transition stash exactly like emitPatchOptimistic. Two forms:
 * - `ops` given (write site): `nextRows` is the draft's intended visible
 *   list, ops the identity diff against the pre-write optimistic view.
 * - `ops === null` (revert site): RESYNC — the consumer rebuilds retention
 *   by row identity against the live post-revert view, resolved from the
 *   target at drain time (overrides are gone by then, so `pb ?? v` IS the
 *   committed truth). */
export function emitRowOpsOptimistic(
  t: StoreNextTarget,
  nextRows: any[] | null,
  ops: RowOps | null
): void {
  const list = (t.pc !== null ? t.pc.ro : null) as RowOpsEntry[] | null;
  if (list === null) return;
  if (optQueue === null) optQueue = [];
  // Snapshot at emission, unbind safety via `u` marks — see emitSlotPatch.
  optQueue.push({
    list: list.slice() as unknown as PatchEntry[],
    next: nextRows,
    prev: null,
    force: false,
    t: nextRows === null ? t : null,
    ops
  });
  if (!scheduled) {
    scheduled = true;
    globalQueue.enqueue(EFFECT_RENDER, drainApplyQueue);
  }
}

/**
 * Register a compiled patch on a store record. Multi-consumer (two lists
 * can render one record); owner-scoped for disposal. Returns unbind.
 */
// Global registration count: the cheap gate emission sites check before any
// per-record work (unpatched apps pay one number compare per transition).
let patchCount = 0;
/** Test-only accounting probe: the live registration count must return to
 * baseline across register/unbind/demote cycles. @internal */
export function patchCountForTests(): number {
  return patchCount;
}

export function hasPatches(): boolean {
  return patchCount > 0;
}

interface ProcessedManifest {
  roots: PropertyKey[];
  dp: DeepNode[] | null;
}
const manifestCache = new WeakMap<string[], ProcessedManifest>();

/** Insert a dot-split path into the prefix tree (see PatchChannel.dp). */
function insertPath(dp: DeepNode[], segs: string[]): void {
  let level = dp;
  for (let d = 0; d < segs.length; d++) {
    let node: DeepNode | undefined;
    for (let i = 0; i < level.length; i++) {
      if (level[i].k === segs[d]) {
        node = level[i];
        break;
      }
    }
    if (node === undefined) {
      node = { k: segs[d], c: null };
      level.push(node);
    }
    if (d < segs.length - 1) level = node.c ??= [];
  }
}

function internManifest(keys: string[]): ProcessedManifest {
  let m = manifestCache.get(keys);
  if (m !== undefined) return m;
  const roots: PropertyKey[] = [];
  let dp: DeepNode[] | null = null;
  for (const k of keys) {
    if (typeof k === "string" && k.indexOf(".") !== -1) {
      const segs = k.split(".");
      if (roots.indexOf(segs[0]) === -1) roots.push(segs[0]);
      insertPath((dp ??= []), segs);
    } else if (roots.indexOf(k) === -1) {
      roots.push(k);
    }
  }
  m = { roots, dp };
  manifestCache.set(keys, m);
  return m;
}

function cloneTree(dp: DeepNode[]): DeepNode[] {
  return dp.map(n => ({ k: n.k, c: n.c === null ? null : cloneTree(n.c) }));
}

/** Copy-on-write guard for interned key structures (see registerPatch). */
function ensureOwnedKeys(pc: { ak: PropertyKey[] | null; dp: DeepNode[] | null; ks?: boolean }) {
  if (pc.ks === true) {
    pc.ak = pc.ak === null ? null : pc.ak.slice();
    pc.dp = pc.dp === null ? null : cloneTree(pc.dp);
    pc.ks = false;
  }
}

function unionKeys(
  pc: { ak: PropertyKey[] | null; dp: DeepNode[] | null; ks?: boolean },
  keys: Iterable<PropertyKey>
): void {
  ensureOwnedKeys(pc);
  const ak = (pc.ak ??= []);
  for (const k of keys) {
    if (typeof k === "string" && k.indexOf(".") !== -1) {
      const segs = k.split(".");
      if (ak.indexOf(segs[0]) === -1) ak.push(segs[0]);
      insertPath((pc.dp ??= []), segs);
    } else if (ak.indexOf(k) === -1) ak.push(k);
  }
}

/** NODE DELIVERY (the structural successor to the queue machinery): one
 * plain version signal per channel, bumped at the emission seams; ONE
 * render effect per channel dispatches every entry with an exact
 * manifest-shaped prev snapshot. Timing — transitions, holds, lanes,
 * merges, mount order — is scheduler-owned by construction. */
function bumpDelivery(pc: any): void {
  if (pc.dn === null) return;
  // Synchronous dedup counter + pure-notification signal: the WRITE may be
  // held by a transition (its commit IS the delivery moment), but the
  // dispatch decision must never read a mid-commit signal value.
  pc.bc = (pc.bc ?? 0) + 1;
  setSignal(pc.dn, (v: number) => v + 1);
}

function bumpDeliveryOptimistic(pc: any): void {
  if (pc.dn === null) return;
  // Override-armed write: in-flight visibility now, re-notify on revert —
  // the engine is installed by every optimistic caller of this seam.
  pc.bc = (pc.bc ?? 0) + 1;
  if ((globalThis as any).__DBG__)
    console.log("[opt-bump] bc:", pc.bc, new Error().stack?.split("\n")[2]?.trim());
  const w = GlobalQueue._optimisticWrite;
  if (w !== null && w !== undefined) w(pc.dn, (pc.dn._value ?? 0) + 1);
  else setSignal(pc.dn, (v: number) => v + 1);
}

/** Manifest-shaped prev snapshot: roots copied flat, deep paths rebuilt as
 * nested literals — compares stay exact even when folds mutate backings in
 * place, which is what let forced re-applies retire entirely. */
function manifestSnapshot(pc: any, next: any): any {
  if (next === null || typeof next !== "object") return next;
  const snap: any = Array.isArray(next) ? next.slice() : { ...next };
  const dp = pc.dp as DeepNode[] | null;
  if (dp !== null) for (let i = 0; i < dp.length; i++) snapNode(dp[i], next, snap);
  return snap;
}

function snapNode(node: DeepNode, src: any, dst: any): void {
  if (src === null || typeof src !== "object") return;
  const v = src[node.k];
  if (node.c === null) {
    dst[node.k] = v;
    return;
  }
  if (v === null || typeof v !== "object") {
    dst[node.k] = v;
    return;
  }
  const child: any = Array.isArray(v) ? [] : {};
  dst[node.k] = child;
  for (let i = 0; i < node.c.length; i++) snapNode(node.c[i], v, child);
}

/** What an untracked reader sees RIGHT NOW: optimistic families serve the
 * override view, held targets the mask, everyone else committed. THE single
 * visibility decision — the queue design made it at five different seams. */
function visibleView(t: StoreNextTarget, pc?: any): any {
  // THROUGH THE PROXY when raw reads can go stale: optimistic families
  // (tentative values live in node overrides at any depth) and DEEP-PATH
  // channels (eager child adoption swaps nested backings without rewriting
  // ancestor raw slots — the queue design's forcedNext made the same
  // call). Untracked proxy reads resolve both. Everyone else: the SAME
  // hold resolution the store's traps use (heldMaskView checks whether the
  // holding transition finished), else committed raw.
  if (t.fam?.opt === true) return t.px;
  if (pc !== undefined && pc.dp !== null) return t.px;
  const hm = heldMaskView(t);
  return hm !== null ? hm : t.v;
}

function ensureDelivery(t: StoreNextTarget, pc: any): void {
  if (pc.de !== undefined) return;
  // The delivery SIGNAL and its bookkeeping persist across consumer churn
  // (only the effect root lives with consumers): a write-time emission held
  // by a transition rides the signal's pending commit — disposing the
  // signal with the last consumer dropped that delivery, permanently
  // staleing a consumer registered before the settle.
  if (pc.dn === null) {
    const dn = (pc.dn = signal(0, { equals: false }));
    // Arm the override slot (NOT_PENDING) WITHOUT CONFIG_OPTIMISTIC: plain
    // bumps keep held-write semantics under transactions, while optimistic
    // bumps route through the engine's write with correct revert
    // registration (an UNARMED slot reads as an active override there —
    // INV-2 caught the miss).
    ext(dn)._overrideValue = NOT_PENDING;
    // Internal machinery: bumps fire from walk/fold seams that may run
    // under owned scopes (the queue design pushed arrays there; a signal
    // write must carry the same exemption).
    (dn as any)._config |= CONFIG_OWNED_WRITE;
    pc.dv = 0; // last dispatched bump count — the pure-registration flush skips
    pc.bc = 0;
  }
  const dn = pc.dn;
  // OWNER-NEUTRAL delivery: the channel is shared infrastructure (multi-
  // consumer across boundaries) — created under a boundary's computation,
  // the effect would land in that boundary's queue and miss lane-timed
  // runs (bisected: boundary-owned registrations got no in-flight
  // deliveries). Errors still route per-entry to each REGISTRANT's owner.
  runWithOwner(null, () =>
    createRoot(d => {
      pc.de = d;
      createRenderEffect(
        () => readSignal(dn) as number,
        () => {
          if (pc.bc === pc.dv) return; // pure-registration run: baselines are per-entry
          pc.dv = pc.bc;
          const p = pc.p as PatchEntry[] | null;
          if (p === null) return; // demoted or emptied — inert
          // Deferred demotion (tentative getter views): performed HERE — the
          // delivery effect is clean, lane-timed effect context, so the
          // re-driven bodies subscribe correctly (creations inside a setter's
          // write window never track).
          if (pc.dmq === true) {
            pc.dmq = false;
            demoteToEffects(t, true);
            return;
          }
          // Payload fast path (raw-read thesis): self emissions stashed
          // their fresh state (bc-tagged against later bumps/reverts) —
          // deliveries read it RAW. Proxy resolution only for payload-less
          // dispatches (ancestor bumps, optimistic views, holds).
          const npHit = pc.np !== undefined && pc.npb === pc.bc;
          if ((globalThis as any).__DBG__ !== undefined)
            (globalThis as any).__DBG__[npHit ? "hit" : "miss"]++;
          const next = npHit ? pc.np : visibleView(t, pc);
          pc.np = undefined;
          const snap = p.length > 1 ? p.slice() : p;
          let firstError: unknown = UNSET;
          firstError = applyEntries(snap, next, PER_ENTRY_PREV, false, firstError, pc);
          if (firstError !== UNSET) {
            // CHANNEL CONTRACT (round-2 pin): every healthy patch applies
            // before an unboundaried error crashes the system. A raw rethrow
            // here would halt sibling channels' render-phase effects — defer
            // the halt one phase so the flush still throws, after siblings.
            const err = firstError;
            globalQueue.enqueue(EFFECT_USER, () => {
              haltReactivity(err);
              throw err;
            });
          }
        }
      );
    })
  );
}

export function registerPatch(record: any, fn: PatchFn, keys?: Iterable<PropertyKey>): () => void {
  let t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined) throw new Error("registerPatch: not a store record");
  // Chained backings (§7b): register on the ULTIMATE owner — that is where
  // value transitions fold and dispatch; the wrapper's identity is stable
  // and would never fire (see ultimateTarget).
  t = ultimateTarget(t) ?? t;
  if (!commitHookInstalled) {
    commitHookInstalled = true;
    armPatchHooks();
    setPatchCommitHook(releaseBatch);
    GlobalQueue._drainPatchOptimistic = drainOptimistic;
  }
  const entry: PatchEntry = { fn, owner: getOwner() };
  const pc = pcOf(t);
  if (__TEST__) devTrackChannel(pc);
  const list = (pc.p ??= []) as PatchEntry[];
  list.push(entry);
  // Accessed-key union (prod-sound adoption demotion). Two sources:
  // compiler MANIFESTS (re-audit 7, P1-1 — the static read envelope,
  // complete across ternary/logical branches; dot-joined strings mark
  // nested chains and split into deep paths) and recording-proxy sets from
  // manifest-less callers (executed reads only; hydration registrations
  // without a manifest record at their first drain apply instead).
  //
  // Manifests are INTERNED by array identity: compiled templates share ONE
  // manifest literal across every row they bind, so the split/dedup runs
  // once and each channel takes the processed arrays BY REFERENCE (list
  // mounts were paying ~3 ms/1000 rows for per-row processing). Shared
  // arrays are copy-on-write: any later union (a second template on the
  // same record, drain-side recording) clones first via ensureOwnedKeys.
  if (keys !== undefined) {
    if (Array.isArray(keys)) {
      const m = internManifest(keys as string[]);
      if (pc.ak === null && pc.dp === null) {
        pc.ak = m.roots;
        pc.dp = m.dp;
        pc.ks = true;
      } else if (pc.ak !== m.roots) {
        unionKeys(pc, keys);
      }
    } else {
      unionKeys(pc, keys);
    }
    entry.k = true; // read envelope known — no drain-side recording
  }
  patchCount++;
  ensureDelivery(t, pc);
  // PER-ENTRY prev baseline (node delivery): the state this consumer's
  // initial apply saw — a consumer mounting mid-batch compares against the
  // batch's outcome (no duplicate setter writes), while one mounting
  // mid-transaction compares against the held view (the commit delivers).
  // No counters, no skip rules: the compare IS the decision.
  // ZERO-ALLOC baselines: raw backings are immutable after adoption swaps,
  // so the baseline is a REFERENCE; the overlay (in-place) fold — the one
  // mutator — clones just-in-time via prepareInPlaceFold, exactly where the
  // queue design ran clonePrev. Optimistic views are proxies: snapshot
  // (UNTRACKED — a tracked spread subscribes the registrant's computation).
  (entry as any).pv =
    t.fam?.opt === true ? untrack(() => manifestSnapshot(pc, t.px)) : (heldMaskView(t) ?? t.v);
  // Bindings are subscriptions for reachability (§6d pruning must descend
  // into bound records).
  markDescendants(t);
  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
    (entry as any).u = true; // dispatch snapshots skip severed consumers
    // Decrement ONLY on actual removal: a demotion (demoteToEffects) may
    // have already pulled this entry and repaired the count — the splice
    // miss is how this closure learns that.
    const idx = list.indexOf(entry);
    if (idx >= 0) {
      list.splice(idx, 1);
      patchCount--;
    }
    if (list.length === 0 && pc.p === list) {
      pc.p = null;
      if (pc.de !== undefined) {
        (pc.de as () => void)();
        pc.de = undefined;
        // dn/bc/dv/pv persist: held write-time emissions must survive
        // consumer churn (see ensureDelivery).
      }
    }
  };
}

/** Resolve a captured RAW record to its live proxy under `list`'s family
 * (re-audit 8, P1-2): structural operations carry raw row arrays captured at
 * emission — the driver must BIND those records, and indexing the live
 * subject instead builds the wrong row once a second operation queues.
 * Shallow slot values (never wrapped) resolve to themselves. */
export function patchProxyFor(list: any, raw: any, key?: PropertyKey): any {
  if (raw === null || typeof raw !== "object" || !isWrappable(raw)) return raw;
  let t: StoreNextTarget | undefined = list?.[$TARGET];
  if (t === undefined) return raw;
  t = ultimateTarget(t) ?? t;
  if (t === undefined || t.s === true) return raw; // shallow rows are raw
  // Same wrap a live `list[key]` read performs (fresh records create their
  // target here — bind-time is their first touch), minus the live indexing.
  // Routed through the createTarget-installed hook: the list target's very
  // existence proves it is installed, and the indirection keeps the trap/
  // write engine shakeable in store-less bundles.
  return wrapRecordHook!(raw, t, key ?? null, t.fam);
}

/** Resolve a target through CHAINED backings (§7b) to the ultimate owner.
 * A projection family wrapper's backing IS another store's proxy: value
 * transitions fold on the ULTIMATE target (the wrapper's identity never
 * changes), so patch registration and raw resolution must land there or
 * registered patches never fire (equivalence-matrix finding: projection
 * value ticks froze driver rows while classic effects tracked through). */
function ultimateTarget(t: StoreNextTarget): StoreNextTarget | undefined {
  while (t.ch) {
    const u: StoreNextTarget | undefined = (t.pb ?? t.v)?.[$TARGET];
    if (u === undefined) return undefined;
    t = u;
  }
  return t;
}

/** Dual-driver bind probe (compiler runtime contract): when `record` is a
 * patchable store record, returns its CURRENT raw backing (the driver's
 * initial force-apply reads it directly — no proxy traffic, no tracking);
 * returns undefined otherwise (driver falls back to the effect path).
 * Not patchable: non-records, non-proxies, accessor-bearing records
 * (patches read raw — getters need tracked evaluation), broken chains. */
export function patchableRaw(record: any, keys?: string[]): Record<PropertyKey, any> | undefined {
  let t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined || t.px !== record || t.a === true) return undefined;
  t = ultimateTarget(t);
  // SCAN before trusting (re-audit blocker 3): `a` starts false and is only
  // discovered lazily (first draft, deep walks) — admission must run the
  // one-time own-accessor scan itself, or a getter-bearing record takes the
  // patch path and its getter's OUTSIDE dependencies (signals, other
  // records) never re-apply. Sticky `sc` makes this one probe pass per
  // record lifetime.
  if (t === undefined || !targetIsPlain(t)) return undefined;
  // COMMITTED-VISIBLE view (re-audits 8/9): a driver mounting
  // mid-transition must render what an untracked reader sees. Adoption
  // swaps t.v SPECULATIVELY under a transition (#3074) — the visible truth
  // is the held mask until the hold resolves; the held entry's release
  // re-applies the resolved state to the mount.
  const hm = heldMaskView(t);
  const raw = (hm ?? t.v) as Record<PropertyKey, any>;
  // Manifest deep-path admission (re-audit 8, P1-1): a getter ALREADY
  // nested on a declared read path rejects patch admission outright — the
  // adoption gates only see FUTURE adoptions.
  if (keys !== undefined) {
    const m = internManifest(keys);
    if (m.dp !== null && !deepPathsPlain(m.dp, raw)) return undefined;
  }
  return raw;
}

/** Accessor demotion (design §5): a record that acquires an accessor after
 * registration stops being patchable — reads must go through tracked
 * evaluation. Clears patches and repairs the global count; callers re-drive
 * the pulled bodies (demoteToEffects). */
export function demotePatches(t: StoreNextTarget): PatchEntry[] | null {
  if (t.pc === null) return null;
  const p = t.pc.p as PatchEntry[] | null;
  t.pc.p = null;
  if (p === null) return null;
  patchCount -= p.length;
  // Drain IN PLACE: unbind closures captured this array — a late unbind must
  // miss its indexOf and not double-decrement the repaired count.
  return p.splice(0, p.length);
}

/** The demotion re-drive (re-audit blocker 3): each pulled body becomes the
 * SAME dual-driver effect fallback the web runtime would have chosen had the
 * record carried the accessor at bind — a tracked compute pass (next === prev
 * short-circuits every compare into a pure read THROUGH THE PROXY, so getter
 * dependencies track) plus an untracked force-apply at effect timing.
 *
 * Creation is DEFERRED to the effect phase: the trap that discovers the
 * accessor runs mid-draft, and an effect's initial pass must not read
 * through the proxy inside the write window. The record's own transition
 * for that draft is covered by the new effect's initial force-apply.
 *
 * Known edge (documented): a demoted LIST-ROW body re-drives under its
 * registering owner (the list owner), so per-row severing on removal is
 * lost for demoted rows — the effect lives until the LIST disposes. Rows
 * only demote when user code defines an accessor on a row record at
 * runtime. */
/** In-place folds mutate the committed backing — reference baselines and
 * stashed payloads pointing at it must clone/invalidate FIRST (the queue's
 * clonePrev moment, now pay-per-overlay-fold instead of per-emission). */
export function prepareInPlaceFold(t: StoreNextTarget): void {
  const pc = t.pc as any;
  if (pc === null) return;
  const v = t.v;
  const p = pc.p as PatchEntry[] | null;
  if (p !== null) {
    for (let i = 0; i < p.length; i++) {
      if ((p[i] as any).pv === v) (p[i] as any).pv = untrack(() => manifestSnapshot(pc, v));
    }
  }
  if (pc.np === v) pc.np = undefined; // the post-merge bump re-stashes
}

export function demoteToEffects(t: StoreNextTarget, immediate = false): void {
  const entries = demotePatches(t);
  if (entries === null || entries.length === 0) return;
  const proxy = t.px;
  // Lane-timed demotions run their re-drives NOW (re-audit 9, P1-4): the
  // optimistic drain IS effect timing, and the global render queue is
  // stashed by the in-flight action — deferring would postpone the
  // tentative view (and the getter's tracked evaluation) to settle.
  const redrive = () => {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.owner !== null && isDisposed(entry.owner)) continue;
      const fn = entry.fn;
      runWithOwner(entry.owner, () =>
        createRenderEffect(
          () => {
            fn(proxy, proxy, false);
          },
          () => {
            // Block body: a compiled patch body's return value must not be
            // mistaken for an effect cleanup.
            untrack(() => fn(proxy, undefined, true));
          }
        )
      );
    }
  };
  if (immediate) redrive();
  else globalQueue.enqueue(EFFECT_RENDER, redrive);
}

// ---------------------------------------------------------------------------
// Row ops (PR-B): structural list transitions for keyed arrays.

/** Structural ops for one keyed-array transition. `prefix` rows key-matched
 * in place; for each later index i (absolute), `sources[i - prefix]` is the
 * OLD index its row retained from, or -1 for a new row. `removed` holds the
 * dropped old row values (unbind/teardown handles). Aligned value ticks emit
 * NOTHING — ops exist only when structure changed. */
export interface RowOps {
  prefix: number;
  sources: number[];
  removed: any[];
}

/** `ops === null` is the RESYNC form (optimistic revert): the consumer
 * rebuilds retention by row identity against `next` (the live view). */
export type RowOpsFn = (next: any[], ops: RowOps | null) => void;

interface RowOpsEntry {
  fn: RowOpsFn;
  owner: Owner | null;
}

/** Register a structural-ops consumer on a keyed store array (the list
 * container's channel — what `For` consumes through the seam). */
export function registerRowOps(array: any, fn: RowOpsFn): () => void {
  let t: StoreNextTarget | undefined = array?.[$TARGET];
  if (t === undefined) throw new Error("registerRowOps: not a store array");
  // Chained backings resolve to the ULTIMATE owner, same as registerPatch
  // (§7b) — the walk/fold emits there (re-audit blocker 4).
  t = ultimateTarget(t) ?? t;
  armRowHooks();
  if (!commitHookInstalled) {
    commitHookInstalled = true;
    armPatchHooks();
    setPatchCommitHook(releaseBatch);
    GlobalQueue._drainPatchOptimistic = drainOptimistic;
  }
  const entry: RowOpsEntry = { fn, owner: getOwner() };
  const pc = pcOf(t);
  if (__TEST__) devTrackChannel(pc);
  const list = (pc.ro ??= []) as RowOpsEntry[];
  list.push(entry);
  patchCount++;
  markDescendants(t);
  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
    (entry as any).u = true; // queued structural work skips severed consumers
    patchCount--;
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0 && pc.ro === list) pc.ro = null;
  };
}

/** Slot patches (shallow arrays) ride the same apply queue: the walk emits
 * per aligned value-replaced slot; application happens at effect phase under
 * the registration owner's lifetime. */
export function emitSlotPatch(t: StoreNextTarget, index: number, next: any, prev: any): void {
  const sp = t.pc !== null ? t.pc.sp : null;
  if (sp === null) return;
  // SNAPSHOT of entry references (re-audit 7, P1-5): structural work is
  // baseline-relative — a consumer registering between emission and drain
  // initialized from CURRENT state and must not receive it. Unbinds still
  // sever queued work through the shared entries' `u` marks (re-audit 6).
  push({
    list: sp.slice() as unknown as PatchEntry[],
    next,
    prev,
    force: false,
    t: null,
    si: index
  });
}

/** Slot patch for shallow arrays: the reconcile walk emits (index, next,
 * prev) for KEY-ALIGNED value-replaced slots (structure rides row ops), and
 * the emission queues through the patch apply queue — effect-phase timing,
 * transition stamping, disposed-owner drop — like every other channel. */
export function registerSlotPatchNext(
  arr: any,
  fn: (index: number, next: any, prev: any) => void
): () => void {
  let t: StoreNextTarget | undefined = arr?.[$TARGET];
  if (t === undefined) throw new Error("registerSlotPatchNext: not a store array");
  // Chained backings resolve to the ULTIMATE owner, same as registerPatch
  // (§7b) — the walk emits slot ticks there (re-audit blocker 4).
  t = ultimateTarget(t) ?? t;
  armRowHooks();
  if (!commitHookInstalled) {
    commitHookInstalled = true;
    armPatchHooks();
    setPatchCommitHook(releaseBatch);
    GlobalQueue._drainPatchOptimistic = drainOptimistic;
  }
  // Multi-consumer (external audit): one shallow array can drive several
  // lists — registrations are a list, unbinds splice their own entry.
  const pc = pcOf(t);
  const entry = { fn, owner: getOwner() };
  (pc.sp ??= []).push(entry);
  markDescendants(t);
  let unbound = false;
  return () => {
    if (unbound || pc.sp === null) return;
    unbound = true;
    (entry as any).u = true; // queued structural work skips severed consumers
    const idx = pc.sp.indexOf(entry);
    if (idx >= 0) pc.sp.splice(idx, 1);
    if (pc.sp.length === 0) pc.sp = null;
  };
}

/** Row-ops ride the SAME apply queue/timing as record patches: transition-
 * stamped, applied at effect phase, in emission order (structure before the
 * new rows' own patches can exist; retained rows' value patches commute). */
export function emitRowOps(t: StoreNextTarget, next: any[], ops: RowOps): void {
  const list = (t.pc !== null ? t.pc.ro : null) as RowOpsEntry[] | null;
  if (list === null) return;
  // Snapshot at emission, unbind safety via `u` marks — see emitSlotPatch.
  push({
    list: list.slice() as unknown as PatchEntry[],
    next,
    prev: null,
    force: false,
    t: null,
    ops
  });
}

// Pay-for-use seams: the write paths (store/reconcile/optimistic) emit
// through installed hooks instead of importing this module. Installation is
// LAZY (first registration) rather than a module-scope call — the dist is a
// flat bundle, and a top-level side effect would retain the whole channel in
// every consumer. TWO TIERS so a value-only registration (registerPatch —
// present in ~every bundle under patch-mode default) does not retain the
// list machinery (row-ops emitters + reconcile's diff builders): row hooks
// arm only from the list driver's registrations. Sound because every
// emission site is guarded by the matching pc channel, which only the
// corresponding registration creates. See patch-hooks.ts.
function armPatchHooks(): void {
  installPatchHooks({
    emitPatch,
    emitPatchLocal,
    emitPatchAncestors,
    emitPatchAncestorsOptimistic,
    emitPatchOptimistic,
    hasPatches,
    demoteToEffects,
    prepareInPlaceFold
  });
  if (__TEST__) InvariantHooks.patchQuiescent = devPatchQuiescent;
}

// ---------------------------------------------------------------------------
// Test-mode channel invariants (PINV, re-audit 7) — the audits kept finding
// accounting/retention bugs one instance at a time; these assert the ledger
// itself at every quiescence point. Pattern: core/invariants.ts.

const devChannels = __TEST__ ? new Set<any>() : (null as never);

function devTrackChannel(pc: unknown): void {
  if (__TEST__) devChannels.add(pc);
}

function devPatchQuiescent(): void {
  let live = 0;
  for (const pc of devChannels) {
    const p = pc.p as unknown[] | null;
    const ro = pc.ro as unknown[] | null;
    if (p === null && ro === null && pc.sp === null) {
      devChannels.delete(pc);
    }
    live += (p?.length ?? 0) + (ro?.length ?? 0);
    assertInvariant(
      pc.bc === undefined || pc.dv === undefined || pc.bc === pc.dv || p === null,
      "PINV-2",
      "a live channel has undispatched bumps at quiescence — a delivery effect was never scheduled or lost its subscription"
    );
  }
  assertInvariant(
    patchCount === live,
    "PINV-1",
    `patchCount (${patchCount}) diverged from the live registration ledger (${live}) — an unbind/demotion path double-counted or leaked`
  );
  assertInvariant(
    queue === null && optQueue === null,
    "PINV-3",
    "the patch apply queue is non-empty at quiescence — queued applications can never run (a release/schedule path lost its drain)"
  );
}

function armRowHooks(): void {
  installRowHooks({
    emitRowOps,
    emitSlotPatch,
    emitSetterRowOps,
    emitRowOpsOptimistic
  });
}
