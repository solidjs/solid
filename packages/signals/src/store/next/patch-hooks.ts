import type { StoreNextTarget } from "./target.js";
import type { RowOps } from "./patch.js";

/**
 * Patch-channel emission seams (pay-for-use). The store/reconcile/optimistic
 * write paths emit through these installed hook objects instead of importing
 * `patch.js` statically, so the channel tree-shakes out of apps that never
 * register a patch consumer.
 *
 * TWO TIERS, armed at registration (patch.js installs them; it is retained
 * only through its registration exports, which only compiled patch-mode
 * output — via the web runtime's driver module — imports):
 * - VALUE hooks (`patchHooks`): record patches. Armed by `registerPatch` —
 *   present in any bundle with one eligible template under patch mode.
 * - ROW hooks (`rowHooks`): list structure (row ops, slot ticks, the
 *   identity/keyed diff builders in reconcile.js they drag in). Armed by
 *   `registerRowOps`/`registerSlotPatchNext` — the LIST driver's
 *   registrations, so value-only bundles never retain the row machinery.
 *
 * Soundness: every emission site is guarded by the matching `pc` channel
 * (`pc.p` for value, `pc.ro`/`pc.sp` for rows), and a target can only
 * acquire that channel through the corresponding registration — so each
 * hook object is installed by the time any guard passes. Type-only imports
 * from `patch.js` are erased.
 */
export interface PatchValueHooks {
  emitPatch(t: StoreNextTarget, next: any, prev: any): void;
  emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void;
  /** Forced ancestor bubble alone (re-audit 7): targeted reconciles cover
   * the walked subtree locally, but ancestor bodies read INTO it through
   * nested chains — the walk root bubbles like a nested setter write. */
  emitPatchAncestors(t: StoreNextTarget): void;
  emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void;
  hasPatches(): boolean;
  demoteToEffects(t: StoreNextTarget): void;
}

export interface PatchRowHooks {
  emitRowOps(t: StoreNextTarget, next: any[], ops: RowOps): void;
  emitSlotPatch(t: StoreNextTarget, index: number, next: any, prev: any): void;
  emitSetterRowOps(t: StoreNextTarget, prevRows: any[], nextRows: any[]): void;
  emitRowOpsOptimistic(t: StoreNextTarget, next: any[] | null, ops: RowOps | null): void;
}

export let patchHooks: PatchValueHooks | null = null;
export let rowHooks: PatchRowHooks | null = null;

export function installPatchHooks(hooks: PatchValueHooks): void {
  patchHooks = hooks;
}

export function installRowHooks(hooks: PatchRowHooks): void {
  rowHooks = hooks;
}
