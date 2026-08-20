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
import { getOwner } from "../../core/owner.js";
import { globalQueue } from "../../core/scheduler.js";
import type { Owner } from "../../core/types.js";
import { $TARGET } from "../store.js";
import { markDescendants, ownedRaw, type StoreNextTarget } from "./target.js";

export type PatchFn = (next: any, prev: any, force?: boolean) => void;

interface PatchEntry {
  fn: PatchFn;
  owner: Owner | null;
}

// Per-flush apply queue. Entries and their args ride parallel arrays to
// keep emission allocation-free beyond the queue slots themselves.
let queueEntries: PatchEntry[][] | null = null;
let queueArgs: any[] = [];
let queueForce: boolean[] = [];
let scheduled = false;

function drainApplyQueue(): void {
  const entries = queueEntries;
  const args = queueArgs;
  const force = queueForce;
  queueEntries = null;
  queueArgs = [];
  queueForce = [];
  scheduled = false;
  if (entries === null) return;
  for (let i = 0; i < entries.length; i++) {
    const list = entries[i];
    const next = args[i * 2];
    const prev = args[i * 2 + 1];
    const f = force[i];
    for (let j = 0; j < list.length; j++) {
      const entry = list[j];
      // Disposed owners drop their patches (the row unmounted mid-flush).
      if (entry.owner !== null && (entry.owner as any)._disposed) continue;
      entry.fn(next, prev, f);
    }
  }
}

function push(list: PatchEntry[], next: any, prev: any, force: boolean): void {
  if (queueEntries === null) queueEntries = [];
  queueEntries.push(list);
  queueArgs.push(next, prev);
  queueForce.push(force);
  if (!scheduled) {
    scheduled = true;
    globalQueue.enqueue(EFFECT_RENDER, drainApplyQueue);
  }
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
  if (p !== null) push(p, next, ownedRaw.has(prev) ? clonePrev(prev) : prev, false);
  // Bubbling: ancestors force-re-apply from their current backing.
  let u = t.u;
  while (u !== null) {
    const up = u.p as PatchEntry[] | null;
    if (up !== null) push(up, u.pb ?? u.v, null, true);
    u = u.u;
  }
}

/** Emission for sites that already stand at the record with both sides in
 * hand and have already handled ancestors (the adoption walk descends —
 * parents were visited first), so no bubbling walk. */
export function emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void {
  const p = t.p as PatchEntry[] | null;
  if (p !== null) push(p, next, ownedRaw.has(prev) ? clonePrev(prev) : prev, false);
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
