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
import { $TARGET } from "../store.js";
import { markDescendants, ownedRaw, type StoreNextTarget } from "./target.js";
import { installPatchHooks, installRowHooks } from "./patch-hooks.js";
// One-way: reconcile emits through the hooks (never imports this module),
// so pulling its setter-channel emitter here creates no cycle.
import { emitSetterRowOps } from "./reconcile.js";
// Cycle with store.js is benign (established pattern above): both resolve at
// call time, long after module initialization.
import { targetIsPlain } from "./store.js";
import { runWithOwner, untrack } from "../../core/core.js";
import { createRenderEffect } from "../../signals.js";
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
    clearStamp(q[i]);
    const { prev, force, t } = q[i];
    const next = t !== null ? (t.pb ?? t.v) : q[i].next;
    if (q[i].ops !== undefined || q[i].si !== undefined)
      firstError = applyStructural(q[i], next, firstError);
    else firstError = applyEntries(liveValueList(q[i]), next, prev, force, firstError, q[i].pc);
  }
  if (firstError !== UNSET) {
    // Unhandled patch errors HALT like unhandled effect errors (re-audit 2,
    // P1-4): app state is undefined past an unboundaried throw.
    haltReactivity(firstError);
    throw firstError;
  }
}

const EMPTY_LIST: PatchEntry[] = [];

/** VALUE entries dispatch to the channel's CURRENT consumer list (re-audit
 * 7, P2-9): applications are absolute (latest state), so they belong to
 * whoever is registered at drain time — a consumer list recreated while the
 * entry was transition-held (or coalesced across a merge) must receive the
 * commit, and a fully-unbound channel receives nothing. Entries without a
 * channel backref (none exists today) keep their captured list. Structural
 * entries are the DUAL — baseline-relative, snapshotted at emission. */
function liveValueList(item: QueuedApply): PatchEntry[] {
  const pc = item.pc ?? (item.t !== null ? (item.t.pc as QueuedApply["pc"]) : undefined);
  if (pc == null) return item.list;
  return (pc.p as PatchEntry[] | null) ?? EMPTY_LIST;
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
        const ak = (pc.ak ??= []);
        const rec = new Proxy(next as object, {
          get(o, key, r) {
            if (ak.indexOf(key) === -1) ak.push(key);
            return Reflect.get(o, key, r);
          }
        });
        entry.fn(rec, prev, force);
      } else {
        entry.fn(next, prev, force);
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
  if (queue === null) queue = [];
  // Same-drain coalescing for RELEASED entries (re-audit 7): two
  // transitions settling in one flush each release a held entry for the
  // same channel — an effect on that record runs ONCE for the flush, so
  // the channel applies once (earliest prev, latest/live next). pushSelf
  // handles same-batch writes; this is its cross-release twin.
  const pc = (item as any).pc as { qa: unknown; qe: QueuedApply | null } | undefined;
  if (pc !== undefined && !item.force) {
    if (pc.qa === queue && pc.qe !== null) {
      const qe = pc.qe;
      qe.next = item.next;
      qe.list = item.list;
      if (item.t !== null) qe.t = item.t;
      return;
    }
    pc.qa = queue;
    pc.qe = item;
  }
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

/** Self-entry push with SAME-BATCH COALESCING (re-audit 2/3): a record's
 * later non-forced emission into the same container UPDATES the queued
 * entry in place — `next` takes the newest capture (adoption swaps the
 * backing object per emission; dropping the later one applied STALE state),
 * `prev` keeps the batch's earliest (effect semantics: one application per
 * batch spanning the whole window). The entry's consumer list is the live
 * pc.p array, so mid-batch registrants ride the single application. Forced
 * entries and row/slot ops never coalesce; the drain clears the stamps so a
 * quiet record retains nothing from its last batch. */
function pushSelf(pc: { qa: unknown; qe: unknown }, item: QueuedApply): void {
  const tx = activeTransition;
  let arr: QueuedApply[];
  if (tx !== null) {
    let held = (tx as any)._heldPatches as QueuedApply[] | undefined;
    if (held === undefined) (tx as any)._heldPatches = held = [];
    arr = held;
  } else {
    if (queue === null) queue = [];
    arr = queue;
  }
  if (pc.qa === arr && pc.qe !== null) {
    const qe = pc.qe as QueuedApply;
    qe.next = item.next;
    qe.list = item.list; // pc.p can be re-created if emptied mid-batch
    return;
  }
  pc.qa = arr;
  pc.qe = item;
  (item as any).pc = pc;
  arr.push(item);
  if (arr === queue && !scheduled) {
    scheduled = true;
    globalQueue.enqueue(EFFECT_RENDER, drainApplyQueue);
  }
}

/** Drain-side stamp clear (re-audit 3, P2-6): without it a quiet long-lived
 * record's channel retains its last batch's container array, entry, and both
 * captured backings for the record's lifetime. Clears whichever stamp pair
 * (normal or optimistic) this entry holds. */
function clearStamp(item: QueuedApply): void {
  const pc = (item as any).pc as
    | { qa: unknown; qe: unknown; qo: unknown; qeo: unknown }
    | undefined;
  if (pc === undefined) return;
  if (pc.qe === item) {
    pc.qa = null;
    pc.qe = null;
  } else if (pc.qeo === item) {
    pc.qo = null;
    pc.qeo = null;
  }
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
    pushSelf(t.pc!, {
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
    pushSelf(t.pc!, {
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
  // Same isolation/routing primitive as the normal drain (re-audit blocker
  // 5): one throwing optimistic patch must not abort its siblings, and it
  // must reach the registering owner's Errored boundary.
  let firstError: unknown = UNSET;
  for (let i = 0; i < q.length; i++) {
    clearStamp(q[i]);
    const { prev, force, t } = q[i];
    const next = t !== null ? (t.pb ?? t.v) : q[i].next;
    if (q[i].ops !== undefined || q[i].si !== undefined)
      firstError = applyStructural(q[i], next, firstError);
    else firstError = applyEntries(liveValueList(q[i]), next, prev, force, firstError, q[i].pc);
  }
  if (firstError !== UNSET) {
    haltReactivity(firstError);
    throw firstError;
  }
}

export function emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void {
  const p = (t.pc !== null ? t.pc.p : null) as PatchEntry[] | null;
  if (p === null) return;
  if (optQueue === null) optQueue = [];
  if (next === null) optQueue.push({ list: p, next: null, prev: null, force: true, t });
  else {
    // Same-batch coalescing, optimistic container (re-audit 3) — on the
    // DEDICATED optimistic stamp pair (re-audit 7, P2-3): the lane queue
    // must not clobber the normal channel's qa/qe mid-batch.
    const pc = t.pc! as unknown as { qo: unknown; qeo: unknown };
    if (pc.qo === optQueue && pc.qeo !== null) {
      const qe = pc.qeo as QueuedApply;
      qe.next = next;
      qe.list = p;
    } else {
      const item: QueuedApply = { list: p, next, prev, force: false, t: null };
      pc.qo = optQueue;
      pc.qeo = item;
      (item as any).pc = t.pc;
      optQueue.push(item);
    }
  }
  // Backup scheduling: the lane-slot drain covers in-flight application; a
  // stashed regular drain guarantees settle-time application when no lane
  // survives to the final flush (pure reverts).
  if (!scheduled) {
    scheduled = true;
    globalQueue.enqueue(EFFECT_RENDER, drainApplyQueue);
  }
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
  const list = (pc.p ??= []) as PatchEntry[];
  list.push(entry);
  // Accessed-key union (prod-sound adoption demotion): callers that ran the
  // body against a recording proxy hand the read set here; hydration-time
  // registrations record at their first drain apply instead.
  if (keys !== undefined) {
    const ak = (pc.ak ??= []);
    for (const k of keys) if (ak.indexOf(k) === -1) ak.push(k);
    entry.k = true; // recorded at the caller's initial apply
  }
  patchCount++;
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
    if (list.length === 0 && pc.p === list) pc.p = null;
  };
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
export function patchableRaw(record: any): Record<PropertyKey, any> | undefined {
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
  return t.pb ?? t.v;
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
export function demoteToEffects(t: StoreNextTarget): void {
  const entries = demotePatches(t);
  if (entries === null || entries.length === 0) return;
  const proxy = t.px;
  globalQueue.enqueue(EFFECT_RENDER, () => {
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
  });
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
    emitPatchOptimistic,
    hasPatches,
    demoteToEffects
  });
}

function armRowHooks(): void {
  installRowHooks({
    emitRowOps,
    emitSlotPatch,
    emitSetterRowOps,
    emitRowOpsOptimistic
  });
}
