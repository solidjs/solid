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
import { EFFECT_RENDER } from "../../core/constants.js";
import { getOwner, isDisposed } from "../../core/owner.js";
import {
  activeTransition,
  globalQueue,
  setPatchCommitHook,
  type Transition
} from "../../core/scheduler.js";
import type { Owner } from "../../core/types.js";
import { $TARGET } from "../store.js";
import { markDescendants, ownedRaw, type StoreNextTarget } from "./target.js";

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
  const q = queue;
  queue = null;
  scheduled = false;
  if (q === null) return;
  for (let i = 0; i < q.length; i++) {
    const { list, prev, force, t } = q[i];
    const next = t !== null ? (t.pb ?? t.v) : q[i].next;
    for (let j = 0; j < list.length; j++) {
      const entry = list[j];
      // Disposed owners drop their patches (the row unmounted mid-flush).
      if (entry.owner !== null && isDisposed(entry.owner)) continue;
      entry.fn(next, prev, force);
    }
  }
}

// Transition-stamped emissions (§2b, "the walk is not the visibility moment
// inside a transition"): entries stash on their transition and release into
// the live queue when THAT batch commits (patchCommitHook). Reverted
// transitions never commit — their stash drops via WeakMap GC, no revert
// bookkeeping.
const heldByTransition = new WeakMap<Transition, QueuedApply[]>();
let commitHookInstalled = false;

function releaseBatch(batch: Transition): void {
  const held = heldByTransition.get(batch);
  if (held === undefined) return;
  heldByTransition.delete(batch);
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
    let held = heldByTransition.get(tx);
    if (held === undefined) heldByTransition.set(tx, (held = []));
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
 * Emit a record's visibility transition. Callers gate on `t.p !== null ||
 * t.d` cheaply; this function re-checks and walks ancestors (§4b).
 */
export function emitPatch(t: StoreNextTarget, next: any, prev: any): void {
  const p = t.p as PatchEntry[] | null;
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
    const up = u.p as PatchEntry[] | null;
    if (up !== null) push({ list: up, next: null, prev: null, force: true, t: u });
    u = u.u;
  }
}

/** Emission for sites that already stand at the record with both sides in
 * hand and have already handled ancestors (the adoption walk descends —
 * parents were visited first), so no bubbling walk. */
export function emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void {
  const p = t.p as PatchEntry[] | null;
  if (p !== null)
    push({
      list: p,
      next,
      prev: ownedRaw.has(prev) ? clonePrev(prev) : prev,
      force: false,
      t: null
    });
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
  }
  const entry: PatchEntry = { fn, owner: getOwner() };
  const list = (t.p ??= []) as PatchEntry[];
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
    if (list.length === 0 && t.p === list) t.p = null;
  };
}

/** Accessor demotion (design §5): a record that acquires an accessor after
 * registration stops being patchable — reads must go through tracked
 * evaluation. Clears patches; the dual-driver bind's effect fallback takes
 * over (wired by the compiler's bind closure via onDemote). */
export function demotePatches(t: StoreNextTarget): PatchEntry[] | null {
  const p = t.p as PatchEntry[] | null;
  t.p = null;
  return p;
}
