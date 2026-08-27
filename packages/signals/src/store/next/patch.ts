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
import { EFFECT_RENDER, STATUS_ERROR } from "../../core/constants.js";
import { ext } from "../../core/core.js";
import { StatusError } from "../../core/error.js";
import { getOwner, isDisposed } from "../../core/owner.js";
import {
  activeTransition,
  globalQueue,
  GlobalQueue,
  setPatchCommitHook,
  type Transition
} from "../../core/scheduler.js";
import type { Owner } from "../../core/types.js";
import { $TARGET } from "../store.js";
import { markDescendants, ownedRaw, type StoreNextTarget } from "./target.js";
// Cycle with store.js is benign: pcOf is only called at registration time,
// long after both modules initialize.
import { pcOf } from "./store.js";

export type PatchFn = (next: any, prev: any, force?: boolean) => void;

interface PatchEntry {
  fn: PatchFn;
  owner: Owner | null;
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
    const { list, prev, force, t } = q[i];
    const next = t !== null ? (t.pb ?? t.v) : q[i].next;
    for (let j = 0; j < list.length; j++) {
      const entry = list[j];
      // Disposed owners drop their patches (the row unmounted mid-flush).
      if (entry.owner !== null && isDisposed(entry.owner)) continue;
      try {
        entry.fn(next, prev, force);
      } catch (err) {
        let handled = false;
        const owner = entry.owner as any;
        if (owner !== null) {
          const statusErr = new StatusError(owner, err);
          ext(owner)._error = statusErr;
          owner._statusFlags = (owner._statusFlags ?? 0) | STATUS_ERROR;
          handled = owner._queue.notify(owner, STATUS_ERROR, STATUS_ERROR, statusErr);
        }
        if (!handled && firstError === UNSET) firstError = err;
      }
    }
  }
  if (firstError !== UNSET) throw firstError;
}

const UNSET: unique symbol = Symbol();

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
  if (queue === null) queue = [];
  queue.push(item);
  if (!scheduled) {
    scheduled = true;
    globalQueue.enqueue(EFFECT_RENDER, drainApplyQueue);
  }
}

function push(item: QueuedApply): void {
  const tx = activeTransition;
  if (tx !== null) {
    let held = (tx as any)._heldPatches as QueuedApply[] | undefined;
    if (held === undefined) (tx as any)._heldPatches = held = [];
    held.push(item);
    return;
  }
  pushLive(item);
}

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
  const p = (t.pc !== null ? t.pc.p : null) as PatchEntry[] | null;
  if (p !== null)
    push({
      list: p,
      next,
      prev: ownedRaw.has(prev) ? clonePrev(prev) : prev,
      force: false,
      t: null
    });
  // Bubbling: ancestors force-re-apply from their LIVE backing, resolved at
  // drain (privatization may clone it between now and then).
  let u = t.u;
  while (u !== null) {
    const up = (u.pc !== null ? u.pc.p : null) as PatchEntry[] | null;
    if (up !== null) push({ list: up, next: null, prev: null, force: true, t: u });
    u = u.u;
  }
}

/** Emission for sites that already stand at the record with both sides in
 * hand and have already handled ancestors (the adoption walk descends —
 * parents were visited first), so no bubbling walk. */
export function emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void {
  const p = (t.pc !== null ? t.pc.p : null) as PatchEntry[] | null;
  if (p !== null)
    push({
      list: p,
      next,
      prev: ownedRaw.has(prev) ? clonePrev(prev) : prev,
      force: false,
      t: null
    });
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
  for (let i = 0; i < q.length; i++) {
    const { list, prev, force, t } = q[i];
    const next = t !== null ? (t.pb ?? t.v) : q[i].next;
    for (let j = 0; j < list.length; j++) {
      const entry = list[j];
      if (entry.owner !== null && isDisposed(entry.owner)) continue;
      entry.fn(next, prev, force);
    }
  }
}

export function emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void {
  const p = (t.pc !== null ? t.pc.p : null) as PatchEntry[] | null;
  if (p === null) return;
  if (optQueue === null) optQueue = [];
  if (next === null) optQueue.push({ list: p, next: null, prev: null, force: true, t });
  else optQueue.push({ list: p, next, prev, force: false, t: null });
  // Backup scheduling: the lane-slot drain covers in-flight application; a
  // stashed regular drain guarantees settle-time application when no lane
  // survives to the final flush (pure reverts).
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
export function hasPatches(): boolean {
  return patchCount > 0;
}

export function registerPatch(record: any, fn: PatchFn): () => void {
  const t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined) throw new Error("registerPatch: not a store record");
  if (!commitHookInstalled) {
    commitHookInstalled = true;
    setPatchCommitHook(releaseBatch);
    GlobalQueue._drainPatchOptimistic = drainOptimistic;
  }
  const entry: PatchEntry = { fn, owner: getOwner() };
  const pc = pcOf(t);
  const list = (pc.p ??= []) as PatchEntry[];
  list.push(entry);
  patchCount++;
  // Bindings are subscriptions for reachability (§6d pruning must descend
  // into bound records).
  markDescendants(t);
  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
    patchCount--;
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0 && pc.p === list) pc.p = null;
  };
}

/** Dual-driver bind probe (compiler runtime contract): when `record` is a
 * patchable store record, returns its CURRENT raw backing (the driver's
 * initial force-apply reads it directly — no proxy traffic, no tracking);
 * returns undefined otherwise (driver falls back to the effect path).
 * Not patchable: non-records, non-proxies, accessor-bearing records
 * (patches read raw — getters need tracked evaluation). */
export function patchableRaw(record: any): Record<PropertyKey, any> | undefined {
  const t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined || t.px !== record || t.a === true) return undefined;
  return t.pb ?? t.v;
}

/** Accessor demotion (design §5): a record that acquires an accessor after
 * registration stops being patchable — reads must go through tracked
 * evaluation. Clears patches; the dual-driver bind's effect fallback takes
 * over (wired by the compiler's bind closure via onDemote). */
export function demotePatches(t: StoreNextTarget): PatchEntry[] | null {
  if (t.pc === null) return null;
  const p = t.pc.p as PatchEntry[] | null;
  t.pc.p = null;
  return p;
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

export type RowOpsFn = (next: any[], ops: RowOps) => void;

interface RowOpsEntry {
  fn: RowOpsFn;
  owner: Owner | null;
}

/** Register a structural-ops consumer on a keyed store array (the list
 * container's channel — what `For` consumes through the seam). */
export function registerRowOps(array: any, fn: RowOpsFn): () => void {
  const t: StoreNextTarget | undefined = array?.[$TARGET];
  if (t === undefined) throw new Error("registerRowOps: not a store array");
  if (!commitHookInstalled) {
    commitHookInstalled = true;
    setPatchCommitHook(releaseBatch);
    GlobalQueue._drainPatchOptimistic = drainOptimistic;
  }
  const entry: RowOpsEntry = { fn, owner: getOwner() };
  const pc = pcOf(t);
  const list = (pc.ro ??= []) as RowOpsEntry[];
  list.push(entry);
  patchCount++;
  markDescendants(t);
  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
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
  push({
    list: sp.map(e => ({ owner: e.owner, fn: () => e.fn(index, next, prev) })),
    next,
    prev,
    force: false,
    t: null
  });
}

/** Row-ops ride the SAME apply queue/timing as record patches: transition-
 * stamped, applied at effect phase, in emission order (structure before the
 * new rows' own patches can exist; retained rows' value patches commute). */
export function emitRowOps(t: StoreNextTarget, next: any[], ops: RowOps): void {
  const list = (t.pc !== null ? t.pc.ro : null) as RowOpsEntry[] | null;
  if (list === null) return;
  push({
    list: list.map(e => ({
      owner: e.owner,
      fn: (n: any, _p: any) => e.fn(n as any[], ops)
    })),
    next,
    prev: null,
    force: false,
    t: null
  });
}
