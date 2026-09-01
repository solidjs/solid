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
import { createRoot, getOwner, isDisposed } from "../../core/owner.js";
import {
  activeTransition,
  currentTransition,
  globalQueue,
  GlobalQueue,
  setPatchCommitHook,
  type Transition
} from "../../core/scheduler.js";
import type { Owner } from "../../core/types.js";
import { $TARGET, isWrappable } from "../store.js";
import { markDescendants, ownedRaw, type PatchChannel, type StoreNextTarget } from "./target.js";
import { installPatchHooks, installRowHooks, wrapRecordHook } from "./patch-hooks.js";
import { optHooks } from "./target.js";
// One-way: reconcile emits through the hooks (never imports this module),
// so pulling its setter-channel emitter here creates no cycle.
import { emitSetterRowOps } from "./reconcile.js";
// Cycle with store.js is benign (established pattern above): both resolve at
// call time, long after module initialization.
import {
  deepPathsPlain,
  heldMaskView,
  rootKeysCurrent,
  targetIsPlain,
  targetKeysPlain
} from "./store.js";
import type { DeepNode } from "./target.js";

import { InvariantHooks } from "../../core/invariants.js";
import { assertInvariant, emitDiagnostic, shouldWarnGraphSize } from "../../core/dev.js";
import { attrHooks } from "../../core/attribution-hooks.js";
import { runWithOwner, untrack } from "../../core/core.js";
import { createRenderEffect } from "../../signals.js";
import { deliveryEffect } from "../../core/effect.js";
// Cycle with store.js is benign: pcOf is only called at registration time,
// long after both modules initialize.
import { pcOf, repairAncestorSlots } from "./store.js";

export type PatchFn = (next: any, prev: any, force?: boolean) => void;

interface PatchEntry {
  fn: PatchFn;
  owner: Owner | null;
  /** Unbound mark: dispatch snapshots skip severed consumers. */
  u?: boolean;
  /** Demoted mark (round 10.7): severed from PATCH dispatch (the body is
   * becoming an effect) but NOT user-unbound — the redrive installs it;
   * `u` alone means the consumer left and cancels even a queued redrive. */
  dm?: boolean;
  /** Manifest-less registration — holds a ref on the channel's `akAll`
   * full-scan poison (round 10.9, P2). */
  ml?: boolean;
  /** THIS entry's interned manifest (round 10.9, P1): the demotion
   * fallback's compute subscribes exactly this envelope — the channel
   * UNION would make every sibling read (and fail on) every other
   * sibling's keys. null = manifest-less (dual-run fallback). */
  mk?: ProcessedManifest | null;
  /** Fallback-effect disposer (round 10.8): the re-drive's root — unbind
   * calls it so the demoted effect dies with its consumer. */
  dd?: () => void;
  /** Registrant's owner queue (round 10, P1-4): dispatch defers this entry
   * into it while a boundary hold is active — render-effect parity. */
  q?: unknown;
  /** Deferred-into-held-queue dedup flag. */
  hq?: boolean;
  /** Per-entry prev baseline (node delivery). */
  pv?: unknown;
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
  /** Channel backref: STRUCTURAL items carry it as the stable dev
   * diagnostics key + naming/cause anchor (round 10.12 — emission
   * snapshots slice the consumer list, so list identity is per-flush),
   * and the drain consults it for the LATE-REGISTRANT resync sweep
   * (round 10.13: consumers registered between emission and a held
   * drain take the live rebuild instead of permanent staleness). */
  pc?: PatchChannel;
  /** Structural row ops (re-audit 6): entries queue the LIVE consumer list
   * plus the ops payload — cloned wrappers survived unbinding, so stale
   * row callbacks fired after a subject switch. */
  ops?: RowOps | null;
  /** Slot-tick payload index (same live-list rationale as `ops`). */
  si?: number;
  /** Structural version at emission (see PatchChannel.sv): entries apply
   * an item's ops only when their applied-version chain connects
   * (`av === svAt - 1`); gaps take ONE flush-end resync. */
  svAt?: number;
  /** COMMITTED resolution (revert-form resyncs): the settle loop's revert
   * emission conceptually follows the override teardown — the proxy would
   * still compose the dying override at drain time; committed raw is the
   * post-revert truth. Every other resync reads the VISIBLE view. */
  cm?: boolean;
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
    const item = q[i];
    const next = drainNext(item);
    if (next === UNSET) continue;
    if (item.ops !== undefined || item.si !== undefined)
      firstError = applyStructural(item, next, firstError);
  }
  firstError = runResyncs(firstError);
  if (firstError !== UNSET) {
    // Unhandled patch errors HALT like unhandled effect errors (re-audit 2,
    // P1-4): app state is undefined past an unboundaried throw.
    haltReactivity(firstError);
    throw firstError;
  }
}

/** Structural `next` resolution from a live target (structural audit, F2):
 * what an UNTRACKED READER sees — optimistic families compose overrides
 * through the proxy (a resync during an open window must not rebuild to
 * committed backing and drop tentative rows); everyone else the pending
 * or committed raw. Consumers canonicalize rows via patchableRaw, so
 * proxy-composed rows keep identity retention. */
function visibleStructRows(t: StoreNextTarget): any {
  return t.fam?.opt === true ? t.px : (t.pb ?? t.v);
}

/** Drain-side `next` resolution (structural audit F2): live targets read
 * the VISIBLE view at drain time. (The old-contract superseded-work
 * generation gate lived here; the #3164 fold ruling removed landing-time
 * consumption, and with it the stale-work window the gate closed — staged
 * truth now rides the retaining transaction's own queues.) */
function drainNext(item: QueuedApply): unknown {
  const { force, t } = item;
  if (t === null) return item.next;
  if (force) return forcedNext(t);
  // COMMITTED only — never `pb`: a revert-form resync follows the override
  // teardown, and a draft backing lingering at the drain (rows escaped
  // into DOM bindings materialize one) is exactly the state that died.
  return item.cm === true ? t.v : visibleStructRows(t);
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
  // VERSION CHAIN (structural redesign): iterate the LIVE consumer list —
  // membership questions (late registrants, held windows, cross-queue
  // ordering) are answered by version arithmetic, not snapshots. An entry
  // applies an item's payload only when its applied-version chain connects
  // (`av === svAt - 1`): the item's baseline is then EXACTLY the state the
  // entry last saw (its registration read or its previous application).
  // Anything at or below `av` is already covered; any gap marks the entry
  // for ONE flush-end resync (after every queue drains).
  const pc = item.pc;
  if (pc === undefined) return firstError;
  const svAt = item.svAt as number;
  const live = (item.si !== undefined ? pc.sp : pc.ro) as
    | (RowOpsEntry & { hqs?: Set<number>; av?: number; rs?: boolean })[]
    | null;
  if (live === null || live.length === 0) return firstError;
  const dch = __DEV__ && attrHooks !== null ? (pc ?? null) : null;
  const dchannel = item.si !== undefined ? "slot-patch" : "row-ops";
  let dstart = 0;
  if (__DEV__ && attrHooks !== null) {
    attrHooks.patchDispatch((dch as object) ?? (item.list as object), live.length, dchannel, null);
    dstart = performance.now();
  }
  // DELETED-SLOT gate (structural audit F3): a slot tick coalesced with a
  // later shrink indexes past the live list — advance every connected
  // entry's chain WITHOUT delivery (a gap here would force spurious
  // resyncs; the tick is a no-op by rule, not a missed update).
  let gated = false;
  if (item.si !== undefined) {
    const liveRows = visibleStructRows(pc.t as StoreNextTarget);
    if (!Array.isArray(liveRows) || item.si >= liveRows.length) gated = true;
  }
  const snap = live.length > 1 ? live.slice() : live;
  for (let j = 0; j < snap.length; j++) {
    const entry = snap[j];
    if (entry === undefined || entry.u === true) continue;
    if (entry.owner !== null && isDisposed(entry.owner)) continue;
    const av = entry.av as number;
    if (av >= svAt) continue; // covered by its registration read or a resync
    // BOUNDARY HOLD parity (round 10.13): defer INTO the collapsed queue;
    // the deferred run resyncs from live truth and fast-forwards the chain.
    const oq = entry.q as any;
    if (queueIsHeld(oq)) {
      deferHeldStructural(entry as any, oq, item);
      continue;
    }
    if (av !== svAt - 1) {
      // Chain gap: some emission this entry needed was missed (skipped
      // item, cross-queue ordering) — ONE resync at flush end covers it.
      if (entry.rs !== true) {
        entry.rs = true;
        (rsPending ??= []).push([entry as any, pc]);
      }
      continue;
    }
    entry.av = svAt;
    if (gated) continue;
    try {
      if (item.si !== undefined) (entry.fn as any)(item.si, next, item.prev);
      else (entry.fn as any)(next, item.ops ?? null);
    } catch (err) {
      if (!routeEntryError(entry as any, err) && firstError === UNSET) firstError = err;
    }
  }
  // Structural deliveries are attribution EVENTS (round 10.12, P2).
  if (__DEV__ && attrHooks !== null && dch !== null)
    attrHooks.patchStructural(
      (dch as any).t !== undefined ? targetPath((dch as any).t) : null,
      live.length,
      dchannel,
      ((dch as any).dn as any) ?? null,
      performance.now() - dstart
    );
  return firstError;
}

/** Entries that observed a version gap this flush — resynced ONCE, after
 * EVERY queue drains (lane first, then regular: the old per-queue sweep let
 * a live resync be chased by the other queue's stale ops). */
let rsPending: Array<
  [RowOpsEntry & { av?: number; rs?: boolean; hqs?: Set<number> }, PatchChannel]
> | null = null;

function runResyncs(firstError: unknown): unknown {
  const list = rsPending;
  rsPending = null;
  if (list === null) return firstError;
  for (let i = 0; i < list.length; i++) {
    const [entry, pc] = list[i];
    entry.rs = false;
    if (entry.u === true) continue;
    if (entry.owner !== null && isDisposed(entry.owner)) continue;
    const isSlot = pc.sp !== null && (pc.sp as unknown[]).indexOf(entry) !== -1;
    // Fast-forward the chain BEFORE delivering: the resync reads live
    // truth, covering every version up to the channel's current one.
    entry.av = (isSlot ? (pc as any).svs : pc.sv) as number;
    const oq = entry.q as any;
    if (queueIsHeld(oq)) {
      deferHeldStructural(entry as any, oq, {
        pc,
        si: undefined,
        next: null,
        prev: null,
        force: false,
        t: pc.t as StoreNextTarget,
        ops: null,
        list: [] as unknown as PatchEntry[]
      });
      continue;
    }
    try {
      const rows = visibleStructRows(pc.t as StoreNextTarget);
      if (isSlot) {
        // Slot consumers have no whole-list form: tick every live index
        // with the current value (undefined prev fires the compare).
        if (Array.isArray(rows)) {
          for (let si = 0; si < rows.length; si++) (entry.fn as any)(si, rows[si], undefined);
        }
      } else {
        (entry.fn as any)(rows, null);
      }
    } catch (err) {
      if (!routeEntryError(entry as any, err) && firstError === UNSET) firstError = err;
    }
  }
  return firstError;
}

/** The live-state RESYNC form of a structural item: row-ops consumers get
 * `(rows, null)` (the driver rebuilds retention by identity), slot
 * consumers get the CURRENT value at the index with the original prev (the
 * compare fires for anything their initialization predates). Live state is
 * the VISIBLE view (structural audit, F2): optimistic families read
 * through the proxy, and a slot deleted since emission is skipped (F3). */
function structuralResync(entry: { fn: Function }, item: QueuedApply): void {
  const t = item.pc !== undefined ? (item.pc.t as StoreNextTarget) : null;
  const rows = t !== null ? (item.cm === true ? t.v : visibleStructRows(t)) : item.next;
  if (item.si !== undefined) {
    if (t !== null && (!Array.isArray(rows) || item.si >= rows.length)) return;
    entry.fn(item.si, t !== null ? rows[item.si] : item.next, item.prev);
  } else {
    entry.fn(rows, null);
  }
}

/** Deferred structural re-apply for a held consumer (round 10.13): runs
 * FROM its owner queue at release, always in the live resync form. Row
 * consumers dedup to one queued run per hold window (the resync reads
 * live truth — repeats are pure waste); SLOT consumers dedup PER INDEX
 * (fold audit P1): distinct indexes are distinct deliveries — a shared
 * flag collapsed multi-slot batches to the first index, leaving the rest
 * permanently stale. */
function deferHeldStructural(
  entry: { fn: Function; owner: Owner | null; u?: boolean; hq?: boolean; hqs?: Set<number> },
  oq: any,
  item: QueuedApply
): void {
  if (item.si !== undefined) {
    const si = item.si;
    const set = (entry.hqs ??= new Set<number>());
    if (set.has(si)) return;
    set.add(si);
    oq.enqueue(EFFECT_RENDER, () => {
      set.delete(si);
      if (entry.u === true) return;
      if (entry.owner !== null && isDisposed(entry.owner)) return;
      // Release fast-forwards the chain (fold audit 2, P2): the resync
      // reads live truth — without this the next update saw a gap and
      // forced a second, redundant full resync.
      (entry as any).av = ((item.pc as any)?.svs as number) ?? (entry as any).av;
      try {
        structuralResync(entry, item);
      } catch (err) {
        if (!routeEntryError(entry as any, err)) deferHalt(err);
      }
    });
    return;
  }
  deferIntoQueue(entry, oq, () => {
    (entry as any).av = ((item.pc as any)?.sv as number) ?? (entry as any).av;
    try {
      structuralResync(entry, item);
    } catch (err) {
      if (!routeEntryError(entry as any, err)) return err as unknown;
    }
  });
}

const UNSET: unique symbol = Symbol();

/** ONE callback/error primitive for every drain (normal, transition-held,
 * optimistic): per-entry isolation — a throwing patch must not abort its
 * siblings (effect parity) — and failures route through the REGISTERING
 * OWNER's queue chain exactly like a render-effect error (§2b): an Errored
 * boundary above the row collects it. Unhandled errors are aggregated by the
 * caller (first one rethrows after its drain completes). */
/** Deferred re-apply for a consumer whose owner queue is holding (round 10,
 * P1-4): enqueued INTO that queue, so the boundary's own release timing —
 * not the channel's — decides when the entry sees the update. Reads the
 * visible view at RUN time (the settled state, exactly what the held render
 * effect would compute). One queued run per entry per hold window. */
/** ONE held-owner-queue probe (size pass 2): shared by value dispatch,
 * structural dispatch, and demotion scheduling. */
function queueIsHeld(oq: unknown): boolean {
  const probe = GlobalQueue._queueHeld;
  return probe !== null && oq != null && oq !== globalQueue && probe(oq as any);
}

/** ONE deferred-run shape for every held consumer (size pass 2): dedup
 * flag, owner-queue enqueue, liveness guards, error deferral. `run`
 * re-derives from LIVE state at release by construction. */
function deferIntoQueue(
  entry: { u?: boolean; dm?: boolean; hq?: boolean; owner: Owner | null },
  oq: any,
  run: () => unknown
): void {
  if (entry.hq === true) return;
  entry.hq = true;
  oq.enqueue(EFFECT_RENDER, () => {
    entry.hq = false;
    if (entry.u === true || entry.dm === true) return;
    if (entry.owner !== null && isDisposed(entry.owner)) return;
    const err = run();
    if (err !== undefined && err !== UNSET) deferHalt(err);
  });
}

function deferHeldEntry(entry: PatchEntry, oq: any, pc: any): void {
  deferIntoQueue(entry, oq, () => applyEntries([entry], visibleView(pc.t, pc), UNSET, pc));
}

/** Route a consumer's throw to its registering owner's boundary. Shared by
 * dispatch and demotion fanout (round 10, P1-5): the nearest COMPUTED
 * ancestor is the recompute target — <Errored>.reset() recomputes sources,
 * and a plain owner (the list driver's listOwner) is not recomputable; the
 * component/memo scope above it is, and recomputing it rebuilds the rows,
 * exactly what reset means for a throwing render effect. */
function routeEntryError(entry: PatchEntry, err: unknown): boolean {
  const owner = entry.owner as any;
  if (owner === null) return false;
  let source = owner;
  while (source !== null && source._fn === undefined) source = source._parent;
  source ??= owner;
  const statusErr = new StatusError(source, err);
  ext(source)._error = statusErr;
  source._statusFlags = (source._statusFlags ?? 0) | STATUS_ERROR;
  return owner._queue.notify(source, STATUS_ERROR, STATUS_ERROR, statusErr) as boolean;
}

/** One deferred unboundaried halt, a phase after the fanout it must not
 * abort (the round-2 channel contract, shared by every dispatch shape). */
function deferHalt(err: unknown): void {
  globalQueue.enqueue(EFFECT_USER, () => {
    haltReactivity(err);
    throw err;
  });
}

function applyEntries(list: PatchEntry[], next: any, firstError: unknown, pc: any): unknown {
  // SNAPSHOT multi-consumer lists (re-audit 5, P1-3): a callback can dispose
  // a sibling's owner, whose unbind SPLICES this same array mid-iteration —
  // index-walking the live array skips the shifted consumer. The dominant
  // single-consumer case pays nothing; unbound entries are marked so a
  // snapshot never applies a consumer severed by an earlier callback.
  // FIXED WINDOW (re-audit 6, P2-4): the single-consumer fast path aliases
  // the live list — a callback registering ANOTHER patch mid-dispatch must
  // not run it in this same drain (it just received its initial apply).
  const snap = list.length > 1 ? list.slice() : list;
  const len = snap.length;
  for (let j = 0; j < len; j++) {
    const entry = snap[j];
    if (entry === undefined || entry.u === true || entry.dm === true) continue;
    // Disposed owners drop their patches (the row unmounted mid-flush).
    if (entry.owner !== null && isDisposed(entry.owner)) continue;
    // BOUNDARY HOLD parity (round 10, P1-4): a consumer registered under a
    // holding queue (pending Loading / collapsed reveal) defers exactly
    // like the render effect it replaced — the entry re-applies FROM ITS
    // OWN QUEUE at release, reading the visible state of that moment.
    const oq = entry.q as any;
    if (queueIsHeld(oq)) {
      deferHeldEntry(entry, oq, pc);
      continue;
    }
    try {
      const ep = entry.pv;
      // A consumer whose baseline never materialized (projection backing
      // absent at registration) takes its first delivery FORCED — there is
      // nothing to compare against, and compiled bodies only tolerate an
      // undefined prev under force.
      if (ep == null) entry.fn(next, undefined, true);
      else entry.fn(next, ep, false);
      entry.pv = next === pc.t?.px ? untrack(() => manifestSnapshot(pc, next)) : next;
    } catch (err) {
      if (!routeEntryError(entry, err) && firstError === UNSET) firstError = err;
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

/** The VISIBLE-version bump (version-chain redesign): an emission's effect
 * becomes readable exactly when its item enters the LIVE queue — commit-
 * coincident emissions immediately, transition-stashed ones at their
 * releaseBatch. Entries born after this point have the emission's state in
 * their first read, so their `av` starts at or past it. */
function pushLive(item: QueuedApply): void {
  const pc = item.pc as any;
  if (pc !== undefined && item.svAt !== undefined) {
    const k = item.si !== undefined ? "svvs" : "svv";
    if (item.svAt > (pc[k] as number)) pc[k] = item.svAt;
  }
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
    bumpOne(t, pc);
    // RAW PAYLOAD only where raw IS visible truth (#3123 P1, equal-landing
    // flash): optimistic families compose override views at read time — an
    // authoritative landing's committed backing served raw would flash
    // through overrides an EQUAL landing holds. Those deliveries take the
    // visibleView proxy read, same as every classic reader.
    if (t.fam?.opt !== true) {
      pc.np = next;
      pc.npb = pc.bc;
    }
    // Self emission knows both sides — upgrade the chain stamp with the
    // record transition ("store.rows.3 {label: a…} → {label: b…}").
    if (__DEV__ && attrHooks !== null && pc.dn !== null)
      attrHooks.patchEmit(pc.dn, targetPath(t), prev, next, true);
  }
  bumpAncestors(t);
}

/** Ancestor bubble, standalone: for seams whose OWN record cannot patch
 * (demotions, channel-less landings) but whose ancestors' compiled bodies
 * read into the subtree through nested chains. Delegates to the same
 * bubbling primitive every emission uses. */
export function emitPatchAncestors(t: StoreNextTarget): void {
  bumpAncestors(t);
}

/** Tentative (optimistic) ancestor bubble (re-audit 8, P1-3): in-flight
 * visibility rides the LANE queue. Standalone form for seams that handled
 * (or demoted) the record itself. */
export function emitPatchAncestorsOptimistic(t: StoreNextTarget, _tx: unknown): void {
  let origin: unknown = undefined;
  if (__DEV__ && attrHooks !== null)
    origin =
      t.pc !== null && (t.pc as any).dn !== null && (t.pc as any).p !== null
        ? (t.pc as any).dn
        : targetPath(t);
  let u = t.u;
  while (u !== null) {
    if (u.pc !== null) bumpOneOptimistic(u, u.pc, origin);
    u = u.u;
  }
}

/** Historically the "walk handled my ancestors" emission — round 10 made
 * bubbling primitive-owned (pending-dedup makes the redundant walk free),
 * so this IS emitPatch: no seam gets to skip ancestors. */
export const emitPatchLocal = emitPatch;

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
    const item = q[i];
    const next = drainNext(item);
    if (next === UNSET) continue;
    if (item.ops !== undefined || item.si !== undefined)
      firstError = applyStructural(item, next, firstError);
  }
  // Standalone lane drains resync at their own tail; when this drain runs
  // INSIDE drainApplyQueue the pending marks survive to ITS tail — after
  // the regular queue — so a resync can never be chased by stale ops.
  if (queue === null || queue.length === 0) firstError = runResyncs(firstError);
  if (firstError !== UNSET) {
    haltReactivity(firstError);
    throw firstError;
  }
}

export function emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void {
  // Bubbles like every emission (round 10, P1-3): a patch on an ANCESTOR
  // must show a nested optimistic write in flight — the lane view already
  // answers it, and ancestors ride the same lane timing.
  if (t.pc !== null) bumpOneOptimistic(t, t.pc);
  emitPatchAncestorsOptimistic(t, null);
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
    cm: nextRows === null && ops === null,
    ops,
    pc: t.pc as PatchChannel,
    svAt: ((t.pc as any).sv = ((t.pc as any).sv as number) + 1)
  });
  // Lane emissions are visible AT EMISSION (optimism is in-flight
  // visibility) — bump the visible version immediately.
  (t.pc as any).svv = (t.pc as any).sv;
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
  /** Root-aligned deep index: dpr[i] = roots[i]'s deep subtree or null. */
  dpr: (DeepNode | null)[] | null;
}
const manifestCache = new WeakMap<PropertyKey[], ProcessedManifest>();

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

function internManifest(keys: PropertyKey[]): ProcessedManifest {
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
  // Root-aligned deep index (round 10.11, P2): dpr[i] is roots[i]'s deep
  // subtree (or null) — the envelope walk was scanning every deep root per
  // manifest root (quadratic per compute). Built once per interned
  // manifest.
  let dpr: (DeepNode | null)[] | null = null;
  if (dp !== null) {
    dpr = new Array(roots.length);
    for (let i = 0; i < roots.length; i++) {
      dpr[i] = null;
      for (let j = 0; j < dp.length; j++)
        if (dp[j].k === roots[i]) {
          dpr[i] = dp[j];
          break;
        }
    }
  }
  m = { roots, dp, dpr };
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
 * merges, mount order — is scheduler-owned by construction.
 *
 * BUBBLING LIVES HERE (round 10). Every bump walks the ancestor chain —
 * no emission seam decides whether ancestors need delivery, so no seam
 * can forget (three of round 10's blockers were exactly that class:
 * landings, optimistic writes, and adoptions each re-implementing the
 * bubble and missing a case). The pending-dedup below makes the walk
 * nearly free: an ancestor already carrying an undelivered bump exits in
 * two reads, so an N-row reconcile bumps each ancestor once, not N times.
 *
 * PAY-FOR-USE CREATION (mount pass): the signal + effect are built at the
 * FIRST consumer-visible emission, not at registration — a mounted list
 * that never updates allocates nothing here. Once built, the machinery
 * persists across consumer churn AND is never torn down with the last
 * consumer: a held write bumping during an unbound window must still
 * deliver to a consumer that registers before the settle. Channels whose
 * machinery was never built skip silently — a first-ever consumer's
 * registration baseline (`entry.pv`) already reflects those writes.
 * QUIESCENT SKIP (round 10, P2): a built channel with no consumers only
 * keeps bumping while a transition is in flight (the held-window pin);
 * outside one, the write is immediately visible and a future registrant's
 * baseline covers it — no signal write, no inert effect run. */
function bumpOne(t: StoreNextTarget, pc: any, origin?: unknown): void {
  // CANONICAL transaction identity (round 10.7, P1/P2): stamps store —
  // and compares resolve — through currentTransition, so a merge between
  // bumps (A absorbed into B) neither defeats the dedup (A¹B² produced
  // three bumps instead of two) nor retains the merged-away object's
  // generator/application state through the stamp.
  const txn = activeTransition === null ? null : currentTransition(activeTransition);
  if (pc.de === undefined) {
    if (pc.p === null) return;
    ensureDelivery(t, pc);
  } else if (pc.bc !== pc.dv) {
    // Already pending: the one scheduled delivery reads the LATEST visible
    // state (and payload emitters re-stash after this call), so a second
    // signal write adds nothing — WITHIN one transaction scope (round
    // 10.5 F1, refined 10.6). A write under a DIFFERENT transition than
    // the pending bump's must reach the signal: entanglement and merging
    // are SCHEDULER bookkeeping keyed on writes — a skipped write left
    // transition B's involvement unrecorded, and A's resolution could
    // deliver B's still-pending value early. Dedup never outranks the
    // scheduler; repeats inside the SAME transition add nothing to it.
    if (txn === null || (pc.bt != null && currentTransition(pc.bt as Transition) === txn)) {
      // Coalesced bubbles still record their origin (round 10.11, P2).
      if (__DEV__ && attrHooks !== null && origin != null)
        attrHooks.patchOrigin(pc.dn, origin as any);
      return;
    }
  } else if (pc.p === null && txn === null) {
    return;
  }
  // Synchronous dedup counter + pure-notification signal: the WRITE may be
  // held by a transition (its commit IS the delivery moment), but the
  // dispatch decision must never read a mid-commit signal value.
  pc.bc++;
  pc.bt = txn;
  setSignal(pc.dn, (v: number) => v + 1);
  // Cause-chain anchor (attribution parity): AFTER the write, so this
  // record-path stamp replaces the engine's counter stamp. Name-only here
  // (bubbles have no values); self emitters re-stamp with the transition,
  // and ancestor bumps carry the ORIGINATING child (round 10.10, P2).
  if (__DEV__ && attrHooks !== null)
    attrHooks.patchEmit(pc.dn, targetPath(t), null, null, false, origin as any);
}

/** Tracked read of a manifest deep-path subtree THROUGH the proxy — the
 * demotion fallback's compute pass (round 10.9; corrected 10.10): the
 * caller read this node's value ONCE and hands it down — a second read
 * would make an unstable getter track one value and commit another. And
 * FUNCTIONS descend (re-audit 9, P1-8's lesson, again): they carry
 * accessor properties whose dependencies must track. */
function readDeepChildren(node: DeepNode, v: any): void {
  const children = node.c;
  if (children === null || v === null || (typeof v !== "object" && typeof v !== "function")) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const cv = v[child.k]; // the ONE tracked read for this step
    if (child.c !== null) readDeepChildren(child, cv);
  }
}

/** DEV: channel-side HUGE_FAN_OUT twin (attribution parity, round 10.10
 * covering VALUE, ROW-OPS, and SLOT channels): channel consumers are not
 * graph subscribers — a record driving thousands of consumers has ONE
 * delivery-signal edge, so the always-on link warning would never see the
 * structure it exists to catch. Same code, same milestones. */
function warnChannelFanOut(count: number, channel: string): void {
  const message =
    `[HUGE_FAN_OUT] A store record's ${channel} channel has ${count} registered ` +
    `consumers. Every emission on this record dispatches all of them this flush. ` +
    `If many independent consumers ask keyed questions of one record, prefer a ` +
    `per-key store or projection so only the keys whose answer flipped update.`;
  emitDiagnostic({
    code: "HUGE_FAN_OUT",
    kind: "perf",
    severity: "warn",
    message,
    data: { subscribers: count, channel }
  });
  console.warn(message);
}

/** DEV: the record's store path ("store.rows.3") — the name cause chains
 * and rerun events use for patch machinery (matches the "store.key" naming
 * key nodes get under attribution). */
function targetPath(t: StoreNextTarget): string {
  let s = "";
  let x: StoreNextTarget | null = t;
  while (x !== null) {
    if (x.pk != null) s = "." + String(x.pk) + s;
    x = x.u;
  }
  return "store" + s;
}

function bumpAncestors(t: StoreNextTarget): void {
  // Origin for ancestor chain stamps (round 10.10, P2): the child's own
  // delivery signal (its fresh stamp is the cause) or its path — also
  // when the child's channel is DEMOTED (round 10.12): a consumer-less
  // dn's last stamp is a stale pre-demotion transition, not this write.
  let origin: unknown = undefined;
  if (__DEV__ && attrHooks !== null)
    origin =
      t.pc !== null && (t.pc as any).dn !== null && (t.pc as any).p !== null
        ? (t.pc as any).dn
        : targetPath(t);
  let u = t.u;
  while (u !== null) {
    if (u.pc !== null) bumpOne(u, u.pc, origin);
    u = u.u;
  }
}

function bumpOneOptimistic(t: StoreNextTarget, pc: any, origin?: unknown): void {
  const txn = activeTransition === null ? null : currentTransition(activeTransition);
  if (pc.de === undefined) {
    if (pc.p === null) return;
    ensureDelivery(t, pc);
  } else if (
    pc.bc !== pc.dv &&
    txn !== null &&
    pc.bo != null &&
    currentTransition(pc.bo as Transition) === txn
  ) {
    // SAME-TRANSACTION optimistic dedup (round 10.6, P2; canonicalized
    // 10.7): the first bump registered the override + revert bookkeeping
    // with this transaction; a repeat (tentative reconcile + its setter's
    // notifyOptimisticWrites, N nested writes bubbling the same ancestors)
    // adds nothing. Stamped separately from plain bumps (`bt`): a plain
    // HELD write is not lane-visible — an optimistic bump after one must
    // still write.
    if (__DEV__ && attrHooks !== null && origin != null)
      attrHooks.patchOrigin(pc.dn, origin as any);
    return;
  }
  // Override-armed write: in-flight visibility now, re-notify on revert —
  // the engine is installed by every optimistic caller of this seam.
  pc.bc++;
  pc.bo = txn;
  const w = GlobalQueue._optimisticWrite;
  if (w !== null && w !== undefined) w(pc.dn, (pc.dn._value ?? 0) + 1);
  else setSignal(pc.dn, (v: number) => v + 1);
  if (__DEV__ && attrHooks !== null)
    attrHooks.patchEmit(pc.dn, targetPath(t), null, null, false, origin as any);
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
  // The whole machinery persists once built (see bumpOne): a
  // write-time emission held by a transition rides the signal's pending
  // commit — tearing anything down with the last consumer dropped that
  // delivery, permanently staleing a consumer registered before the settle.
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
  //
  // DETACHED PRIMITIVE (mount pass): deliveryEffect is a bare node with one
  // static source — no root, no owner bookkeeping. The node IS pc.de: it
  // is never disposed (persistence rule above); a bump with no consumers
  // takes the inert `p === null` return, and the record's death releases
  // the whole subgraph. The null-owner wrap keeps the queue global.
  runWithOwner(null, () => {
    pc.de = deliveryEffect(
      () => void readSignal(dn),
      () => {
        if (pc.bc === pc.dv) return; // pure-registration run: baselines are per-entry
        pc.dv = pc.bc;
        // The delivery CONSUMES any override on the notification signal
        // (INV-6, fold audit 6): optimistic bumps arm dn so in-flight
        // visibility rides the lane — but dn is PURE NOTIFICATION, and a
        // revert-resync bump at another lane's settle can arm it on a
        // still-open flight (the projection's) that never resolves in this
        // window. Once delivered, the override has no residual meaning —
        // drop it like resolveOptimisticNodes would. `_transition` is left
        // alone on purpose: a plain bump PARKED under a real transaction
        // may still be pending on this node, and its commit bookkeeping
        // keys off that stamp.
        const dnx = (dn as any)._x;
        if (dnx != null && dnx._overrideValue !== undefined && dnx._overrideValue !== NOT_PENDING) {
          dnx._overrideValue = NOT_PENDING;
          dnx._optimisticLane = undefined;
          dnx._overrideOwner = null;
        }
        // Release the transaction stamps (round 10.7, P1): a delivered
        // channel has no pending bump for them to dedup against, and a
        // retained stamp would pin the transition object (generators,
        // application state) for the record's lifetime.
        pc.bt = pc.bo = null;
        // The attribution stamp is CONSUMED (round 10.12, P2): a later
        // self-emission must not inherit this delivery's child causes.
        if (__DEV__ && attrHooks !== null) attrHooks.patchDelivered(pc.dn);
        const p = pc.p as PatchEntry[] | null;
        if (p === null) {
          // Inert (demoted or emptied). A deferred-demotion latch queued for
          // consumers that have since left is CONSUMED here (round 10, P2):
          // it described a view no one is left to demote for — a later
          // plain consumer must not inherit it.
          pc.dmq = false;
          return;
        }
        // Wide-dispatch policy lives in the ENGINE (round 10.10, P2):
        // same thresholds, memo field, and metadata as graph wide-writes.
        if (__DEV__ && attrHooks !== null)
          attrHooks.patchDispatch(pc.dn, p.length, "patch template", pc.dn);
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
        // PAYLOAD-LESS deliveries re-probe the deep manifest (round 10.5,
        // F3): a self emission was probed at its seam, but an ancestor
        // BUBBLE was probed only at the CHILD's seam against the child's
        // keys — a child-subject adoption can carry a getter into a path
        // only THIS channel's bodies read. Cost rides the rare path: dbmon
        // ticks are all payload hits and never probe.
        if (!npHit && pc.dp !== null && !deepPathsPlain(pc.dp, heldMaskView(t) ?? t.v, t)) {
          demoteToEffects(t, true);
          return;
        }
        // Direct object-valued root keys (round 10.6, P1): same currency
        // rule for `dp === null` manifests — a stale alias slot serves the
        // outgoing object raw; demote so the body reads through the proxy.
        // akAll channels (manifest-less consumers) full-scan.
        if (
          !npHit &&
          (pc.ak !== null || pc.akAll === true) &&
          !rootKeysCurrent(t, heldMaskView(t) ?? t.v, pc.akAll === true ? null : pc.ak)
        ) {
          demoteToEffects(t, true);
          return;
        }
        const next = npHit ? pc.np : visibleView(t, pc);
        pc.np = undefined;
        const snap = p.length > 1 ? p.slice() : p;
        let firstError: unknown = UNSET;
        firstError = applyEntries(snap, next, firstError, pc);
        if (firstError !== UNSET) {
          // CHANNEL CONTRACT (round-2 pin): every healthy patch applies
          // before an unboundaried error crashes the system. A raw rethrow
          // here would halt sibling channels' render-phase effects — defer
          // the halt one phase so the flush still throws, after siblings.
          deferHalt(firstError);
        }
      }
    );
    // Rerun events read as "patchDelivery(store.rows.3) ran ← store.rows.3
    // write" — the machinery names itself for attribution.
    if (__DEV__) (pc.de as any)._name = "patchDelivery(" + targetPath(t) + ")";
  });
}

/** Shared registration prologue (size pass 2): resolve the record to its
 * ULTIMATE backing (§7b — chained backings fold and dispatch there; the
 * wrapper's identity is stable and would never fire) and arm the commit
 * hooks once. Row hooks arm separately — value-only apps must not retain
 * the structural walk. */
function channelTarget(record: any, api: string): StoreNextTarget {
  const t: StoreNextTarget | undefined = record?.[$TARGET];
  if (t === undefined) throw new Error(api + ": not a store record");
  // LATE-MOUNT repair (fold audit P1): adoptions before the FIRST patch
  // registration skip the eager parent-slot repair (hasPatches gate) — fix
  // this target's own ancestor chain now, or its currency probes read
  // stale alias slots and demote the binding to the effect fallback
  // forever.
  repairAncestorSlots(t);
  if (!commitHookInstalled) {
    commitHookInstalled = true;
    armPatchHooks();
    setPatchCommitHook(releaseBatch);
    GlobalQueue._drainPatchOptimistic = drainOptimistic;
  }
  return ultimateTarget(t) ?? t;
}

/** Shared structural unbind (size pass 2): mark-severed + splice + empty
 * list release, identical for row-ops and slot-patch consumers. */
function structuralUnbind(
  entry: object & { u?: boolean },
  list: unknown[],
  pc: any,
  field: "ro" | "sp",
  counted: boolean
): () => void {
  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
    entry.u = true; // queued structural work skips severed consumers
    if (counted) patchCount--;
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0 && pc[field] === list) pc[field] = null;
  };
}

export function registerPatch(record: any, fn: PatchFn, keys?: Iterable<PropertyKey>): () => void {
  const t = channelTarget(record, "registerPatch");
  const owner = getOwner();
  // Owner queue captured at registration (round 10, P1-4): dispatch defers
  // into it while its boundary holds — render-effect parity.
  const entry: PatchEntry = { fn, owner, q: (owner as any)?._queue ?? null };
  const pc = pcOf(t);
  if (__TEST__) devTrackChannel(pc);
  const list = (pc.p ??= []) as PatchEntry[];
  // A registration that STARTS the consumer list opens a fresh generation:
  // a deferred-demotion latch can never predate its consumers (round 10,
  // P2 — a stale latch permanently demoted a later plain consumer).
  if (list.length === 0) pc.dmq = false;
  list.push(entry);
  if (__DEV__ && shouldWarnGraphSize(list.length)) warnChannelFanOut(list.length, "patch");
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
      entry.mk = m; // this entry's OWN envelope (demotion computes read it)
      if (pc.ak === null && pc.dp === null) {
        pc.ak = m.roots;
        pc.dp = m.dp;
        pc.ks = true;
      } else if (pc.ak !== m.roots) {
        unionKeys(pc, keys);
      }
    } else {
      // One-shot iterables: materialize once — the union AND the entry's
      // own envelope both need the keys. Keys stay PropertyKey (round
      // 10.10, P1): stringifying a symbol tracked "Symbol(x)" instead of
      // the symbol-keyed property.
      const arr = Array.from(keys as Iterable<PropertyKey>);
      entry.mk = internManifest(arr);
      unionKeys(pc, arr);
    }
  } else {
    // MANIFEST-LESS consumer (hand-written registerPatch; size pass): the
    // read set is unknowable, so adoption gates FULL-SCAN this channel
    // (`akAll` poisons the key union — a partial ak from a manifested
    // sibling must not narrow probes below this consumer's reads). This
    // replaced the drain-side recording proxy: compiled output always
    // ships manifests, so only hand-written callers pay the wider probe.
    // REF-COUNTED (round 10.9, P2): the poison leaves with the last
    // manifest-less consumer — later compiled consumers get manifest-
    // -narrow probes back.
    entry.ml = true;
    entry.mk = null;
    pc.mlc = (pc.mlc ?? 0) + 1;
    pc.akAll = true;
  }
  patchCount++;
  // NO delivery machinery here (mount pass): the signal + effect are built
  // by the first consumer-visible bump (see bumpOne) — a list that
  // mounts and never updates allocates none of it.
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
    // A demoted entry's fallback EFFECT dies with its consumer (round
    // 10.8, P2): queued (held) or live, unbind disposes its root — it
    // neither applies at release nor stays subscribed.
    (entry as any).dd?.();
    // Decrement ONLY on actual removal: a demotion (demoteToEffects) may
    // have already pulled this entry and repaired the count — the splice
    // miss is how this closure learns that.
    const idx = list.indexOf(entry);
    if (idx >= 0) {
      list.splice(idx, 1);
      patchCount--;
      // The full-scan poison leaves with its consumer (round 10.9, P2).
      if (entry.ml === true && --pc.mlc! === 0) pc.akAll = false;
    }
    if (list.length === 0 && pc.p === list) {
      // The delivery machinery (dn/de/bc/dv) persists — held write-time
      // emissions must survive consumer churn, and a re-binding row reuses
      // the node (see bumpOne's persistence rule). The demotion latch does
      // NOT persist (round 10, P2): it belonged to the leaving consumers.
      pc.p = null;
      pc.dmq = false;
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
  // adoption gates only see FUTURE adoptions. CURRENCY-probed with `t`
  // (round 10.5, F2): stale alias slots decline to classic — including
  // direct object-valued ROOT keys (round 10.6, P1: `dp === null`
  // manifests like ["right"] read the object itself).
  if (keys !== undefined) {
    const m = internManifest(keys);
    if (m.dp !== null && !deepPathsPlain(m.dp, raw, t)) return undefined;
    if (!rootKeysCurrent(t, raw, m.roots)) return undefined;
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
  // SEVER as patch consumers (round 10.5, F4; split from `u` in 10.7):
  // these entries become effects — any straggler dispatch holding a
  // reference (a boundary-held deferred callback, a mid-flight snapshot)
  // must skip them, or the body applies once from the effect and AGAIN
  // from the stale callback. `dm`, not `u`: an explicit unbind AFTER
  // demotion must still be able to cancel the queued redrive, and the
  // redrive distinguishes "severed for conversion" from "consumer left".
  // Demoted entries stop being PATCH consumers — the full-scan poison
  // leaves with them (their fallback effects track their own reads).
  for (let i = 0; i < p.length; i++) {
    p[i].dm = true;
    if (p[i].ml === true && --(t.pc as any).mlc === 0) (t.pc as any).akAll = false;
  }
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
  // Demotion IS a visibility event for ancestors (round 10.11, P1): their
  // manifests read INTO this subtree, and the seam that demoted saw a
  // change worth emitting. Bubbled HERE — primitive-owned, like every
  // other emission — so no fold/landing/trap seam can forget, and the
  // already-empty channel (previously demoted, machinery persistent)
  // still reaches its ancestors instead of freezing them. Pending-dedup
  // makes redundant bubbles free.
  bumpAncestors(t);
  const entries = demotePatches(t);
  if (entries === null || entries.length === 0) return;
  const proxy = t.px;
  // Lane-timed demotions run their re-drives NOW (re-audit 9, P1-4): the
  // optimistic drain IS effect timing, and the global render queue is
  // stashed by the in-flight action — deferring would postpone the
  // tentative view (and the getter's tracked evaluation) to settle.
  const redrive = () => {
    // PER-ENTRY ISOLATION (round 10, P1-5): a throwing re-drive must not
    // abort the loop — every healthy sibling still becomes a live effect,
    // errors route to each entry's own boundary, and one unboundaried
    // failure defers a single halt AFTER the fanout (the same contract the
    // dispatch loop pins).
    let firstError: unknown = UNSET;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // An explicit unbind AFTER demotion cancels the redrive (round 10.7,
      // P2): the consumer left — installing its body as an effect would
      // resurrect a subscription nothing owns. (`dm` marks conversion, `u`
      // marks departure — only departure cancels.)
      if (entry.u === true) continue;
      if (entry.owner !== null && isDisposed(entry.owner)) continue;
      const fn = entry.fn;
      // HELD owners schedule their initial run through their own queue
      // (round 10.6, P1): a synchronous force-apply here would write DOM
      // that a collapsed boundary is holding — the same parity rule as
      // dispatch's deferHeldEntry. Warm owners keep the immediate run
      // (lane-timed demotions NEED it: the global render queue is stashed
      // in-flight, and deferral would postpone the tentative view).
      const oq = entry.q as any;
      const held = queueIsHeld(oq);
      // COMPUTE throws are captured PER ENTRY (round 10.8, P1) — a
      // throwing getter would otherwise route through the effect's own
      // error machinery and halt DURING creation/scheduling, before held
      // healthy siblings release. And a FAILED compute must not commit
      // (round 10.9, P1): the latch below makes the commit a no-op for
      // that run — core saw "success", the entry saw its error routed,
      // and recovery (the dependency changing back) re-runs cleanly.
      // Manifested entries compute by READING THEIR OWN ENVELOPE (round
      // 10.9, P1 — the driver's round-9 rule, shared by demotion): the
      // body never runs inside the tracked pass, so NaN fields and
      // unstable getters cannot fire DOM writes during compute. PER
      // ENTRY, never the channel union: the union would subscribe every
      // sibling to every other sibling's keys — and fail every sibling on
      // one sibling's throwing getter. Manifest-less entries keep the
      // documented dual-run, same as the driver's fallback.
      const mk = entry.mk ?? null;
      let computeFailed = false;
      const compute = () => {
        computeFailed = false;
        try {
          if (mk !== null) {
            // Each root reads ONCE (round 10.10, P1): deep roots live in
            // BOTH mk.roots and mk.dp — descending from the already-read
            // value instead of re-reading keeps unstable getters tracking
            // exactly the value the envelope observed. `dpr` is the
            // root-aligned index (round 10.11, P2 — linear, not
            // roots × deep-roots).
            const roots = mk.roots;
            const dpr = mk.dpr;
            for (let k = 0; k < roots.length; k++) {
              const v = (proxy as any)[roots[k]];
              const node = dpr !== null ? dpr[k] : null;
              if (node !== null) readDeepChildren(node, v);
            }
          } else fn(proxy, proxy, false);
        } catch (err) {
          computeFailed = true;
          if (!routeEntryError(entry, err)) deferHalt(err);
        }
      };
      // FIRST scheduled run is per-entry isolated (round 10.7, P1): the
      // queued initial applies run back-to-back at release. Later runs
      // keep classic effect error semantics.
      let first = held;
      const commit = () => {
        if (computeFailed) return; // the tracked pass failed — no apply
        if (first) {
          first = false;
          try {
            untrack(() => fn(proxy, undefined, true));
          } catch (err) {
            if (!routeEntryError(entry, err)) deferHalt(err);
          }
          return;
        }
        // Block body: a compiled patch body's return value must not be
        // mistaken for an effect cleanup.
        untrack(() => fn(proxy, undefined, true));
      };
      try {
        // OWN ROOT per re-driven entry (round 10.8, P2): the entry's
        // unbind disposes it — an explicit unbind after the fallback
        // effect exists (queued OR live) cancels the effect and its
        // subscriptions. TRANSPARENT (round 10.9, P2): the root shares its
        // parent's id, so demotion keeps the classic fallback's
        // owner/hydration-ID depth.
        runWithOwner(entry.owner, () =>
          createRoot(
            d => {
              (entry as any).dd = d;
              createRenderEffect(compute, commit, held ? { schedule: true } : undefined);
            },
            { transparent: true }
          )
        );
      } catch (err) {
        if (!routeEntryError(entry, err) && firstError === UNSET) firstError = err;
      }
    }
    if (firstError !== UNSET) deferHalt(firstError);
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
  /** Unbound mark (queued structural work skips severed consumers). */
  u?: boolean;
  /** Registrant's owner queue (round 10.13): structural dispatch defers
   * into it while a boundary hold is active — render-effect parity. */
  q?: unknown;
  /** Deferred-into-held-queue dedup flag. */
  hq?: boolean;
  /** Per-index deferred-slot dedup (fold audit P1). */
  hqs?: Set<number>;
  /** APPLIED structural version (version-chain redesign): initialized to
   * the channel's VISIBLE version at registration — exactly what the
   * entry's first read covered. Ops apply only on an unbroken chain. */
  av?: number;
  /** Marked for the flush-end resync (a version gap was observed). */
  rs?: boolean;
}

/** Register a structural-ops consumer on a keyed store array (the list
 * container's channel — what `For` consumes through the seam). */
export function registerRowOps(array: any, fn: RowOpsFn): () => void {
  const t = channelTarget(array, "registerRowOps");
  armRowHooks();
  const rowner = getOwner();
  const pc = pcOf(t);
  const rq = (rowner as any)?._queue ?? null;
  const entry: RowOpsEntry = {
    fn,
    owner: rowner,
    q: rq,
    // Speculative-scope init (fold audit 3, P1): a consumer rendering under
    // a HOLDING boundary queue reads the speculative view — its baseline
    // covers the stashed emissions too (sv). The old `activeTransition`
    // probe missed PARKED windows (the flag is execution-scoped; the hold
    // persists). Ambient mounts read committed truth (svv) and receive the
    // stashed ops at release.
    av: ((queueIsHeld(rq) ? ((pc as any).sv as number) : ((pc as any).svv as number)) ??
      0) as number
  };
  if (__TEST__) devTrackChannel(pc);
  const list = (pc.ro ??= []) as RowOpsEntry[];
  list.push(entry);
  if (__DEV__ && shouldWarnGraphSize(list.length))
    warnChannelFanOut(list.length, "row-ops (structural list)");
  patchCount++;
  markDescendants(t);
  return structuralUnbind(entry, list, pc, "ro", true);
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
    si: index,
    pc: t.pc as PatchChannel,
    svAt: ((t.pc as any).svs = ((t.pc as any).svs as number) + 1)
  });
  // Walk/fold state is EAGERLY visible (only notifications batch — fold
  // audit 4): every reader from this moment has the tick's state in its
  // init read, PARKED windows included.
  (t.pc as any).svvs = (t.pc as any).svs;
}

/** Slot patch for shallow arrays: the reconcile walk emits (index, next,
 * prev) for KEY-ALIGNED value-replaced slots (structure rides row ops), and
 * the emission queues through the patch apply queue — effect-phase timing,
 * transition stamping, disposed-owner drop — like every other channel. */
export function registerSlotPatchNext(
  arr: any,
  fn: (index: number, next: any, prev: any) => void
): () => void {
  const t = channelTarget(arr, "registerSlotPatchNext");
  armRowHooks();
  // Multi-consumer (external audit): one shallow array can drive several
  // lists — registrations are a list, unbinds splice their own entry.
  const pc = pcOf(t);
  const sowner = getOwner();
  const sq = (sowner as any)?._queue ?? null;
  const entry = {
    fn,
    owner: sowner,
    q: sq,
    av: (((pc as any).svvs as number) ?? 0) as number
  };
  const list = (pc.sp ??= []) as unknown[];
  list.push(entry);
  if (__DEV__ && shouldWarnGraphSize(list.length))
    warnChannelFanOut(list.length, "slot-patch (shallow list)");
  markDescendants(t);
  return structuralUnbind(entry, list, pc, "sp", false);
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
    ops,
    pc: t.pc as PatchChannel,
    svAt: ((t.pc as any).sv = ((t.pc as any).sv as number) + 1)
  });
  // Adoption commits eagerly (fold audit 4): visible at emission, always.
  (t.pc as any).svv = (t.pc as any).sv;
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
