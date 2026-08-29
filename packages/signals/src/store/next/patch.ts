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
import { deepPathsPlain, targetIsPlain, targetKeysPlain } from "./store.js";
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
  /** Registration generation (re-audit 8, P2-6). */
  gen?: number;
}

// Per-flush apply queue. Bubbled (forced) emissions resolve `next` LAZILY at
// drain time from the live target: privatization can clone an ancestor's
// backing between emission and drain, so a captured reference goes stale.
interface QueuedApply {
  list: PatchEntry[];
  /** Registration-generation watermark (re-audit 8, P2-6): captured at
   * emission; consumers registered LATER are skipped ONLY when the entry
   * was emitted from ALREADY-COMMITTED state (`cm` — re-audit 9, P1-1:
   * walk-in-setter and transition-held emissions carry uncommitted
   * payloads, so late consumers read the OLD committed view and must
   * receive the apply). */
  g?: number;
  cm?: boolean;
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

function clearStamp(_item: QueuedApply): void {}

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
  if (t.pc !== null) bumpDelivery(t.pc);
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
  if (t.pc !== null) bumpDelivery(t.pc);
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
// Registration generation (re-audit 8, P2-6): monotonic; queued entries
// capture the counter at emission so drains can skip consumers that
// initialized from state at-or-after the emission.
let regGen = 0;
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

/** NODE-DELIVERY PROTOTYPE: tracked read of the record's version signal.
 * Creating it counts toward hasPatches() so write-path gates arm. */
export function patchVersion(record: any): void {
  let t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined) return;
  t = ultimateTarget(t) ?? t;
  const pc = pcOf(t);
  if (pc.dn === null) {
    pc.dn = signal(0, { equals: false });
    patchCount++;
    markDescendants(t);
    if (!commitHookInstalled) {
      commitHookInstalled = true;
      armPatchHooks();
      setPatchCommitHook(releaseBatch);
      GlobalQueue._drainPatchOptimistic = drainOptimistic;
    }
  }
  readSignal(pc.dn as any);
}

/** NODE-DELIVERY PROTOTYPE: held-aware committed backing WITHOUT admission
 * scans — the emission-seam gates own accessor soundness; per-delivery
 * re-probing doubled the probe bill. */
export function patchCommittedRaw(record: any): Record<PropertyKey, any> | undefined {
  let t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined) return undefined;
  t = ultimateTarget(t) ?? t;
  if (t === undefined) return undefined;
  return t.ht !== null ? ((t.hv ?? t.v) as Record<PropertyKey, any>) : t.v;
}

/** NODE DELIVERY (the structural successor to the queue machinery): one
 * plain version signal per channel, bumped at the emission seams; ONE
 * render effect per channel dispatches every entry with an exact
 * manifest-shaped prev snapshot. Timing — transitions, holds, lanes,
 * merges, mount order — is scheduler-owned by construction. */
function bumpDelivery(pc: any): void {
  if (pc.dn !== null) setSignal(pc.dn, (v: number) => v + 1);
}

function bumpDeliveryOptimistic(pc: any): void {
  if (pc.dn === null) return;
  // Override-armed write: in-flight visibility now, re-notify on revert —
  // the engine is installed by every optimistic caller of this seam.
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
function visibleView(t: StoreNextTarget): any {
  if (t.fam?.opt === true && optHooks !== null) return optHooks.optimisticView(t, t.pb ?? t.v);
  return t.ht !== null ? (t.hv ?? t.v) : t.v;
}

function ensureDelivery(t: StoreNextTarget, pc: any): void {
  if (pc.dn !== null) return;
  const dn = (pc.dn = signal(0, { equals: false }));
  pc.dv = 0; // last dispatched version — the pure-registration flush skips
  pc.pv = manifestSnapshot(pc, visibleView(t));
  createRoot(d => {
    pc.de = d;
    createRenderEffect(
      () => readSignal(dn) as number,
      (v: number) => {
        if (v === pc.dv) {
          pc.pv = manifestSnapshot(pc, visibleView(t));
          return;
        }
        pc.dv = v;
        const p = pc.p as PatchEntry[] | null;
        if (p === null) return; // demoted or emptied — inert
        const next = visibleView(t);
        const prev = pc.pv;
        const snap = p.length > 1 ? p.slice() : p;
        let firstError: unknown = UNSET;
        firstError = applyEntries(snap, next, prev, false, firstError, pc);
        pc.pv = manifestSnapshot(pc, next);
        if (firstError !== UNSET) throw firstError;
      }
    );
  });
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
  const entry: PatchEntry = { fn, owner: getOwner(), gen: ++regGen };
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
        pc.dn = null;
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
  const raw = t.ht !== null ? ((t.hv ?? t.v) as Record<PropertyKey, any>) : t.v;
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
    demoteToEffects
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
      if (pc.qa === null && pc.qe === null && pc.qo === null && pc.qeo === null)
        devChannels.delete(pc);
      // fall through: a dead channel with live stamps is still a PINV-2 hit
    }
    live += (p?.length ?? 0) + (ro?.length ?? 0);
    assertInvariant(
      pc.qa === null && pc.qe === null && pc.qo === null && pc.qeo === null,
      "PINV-2",
      "a patch channel holds coalescing stamps at quiescence — a drain path skipped clearStamp (retention: the stamped entry pins both captured backings)"
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
