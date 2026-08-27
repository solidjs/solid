import type { StoreNextTarget } from "./target.js";
import type { RowOps } from "./patch.js";

/**
 * Patch-channel emission seam (pay-for-use). The store/reconcile/optimistic
 * write paths emit through this installed hook object instead of importing
 * `patch.js` statically, so the whole patch channel tree-shakes out of apps
 * that never register a patch consumer.
 *
 * `patch.js` installs the hooks at module evaluation; it is retained only
 * through its registration exports (`registerPatch`/`registerRowOps`/
 * `registerSlotPatch`/`patchableRaw`), which only compiled patch-mode
 * output (via the web runtime's driver module) imports.
 *
 * Soundness: every emission site is guarded by `t.pc` (or `hasPatches()`
 * through the hooks themselves), and a target can only acquire a `pc`
 * through `patch.js` registration — so the hooks are always installed by
 * the time any guard passes. Type-only imports from `patch.js` are erased.
 */
export interface PatchHooks {
  emitPatch(t: StoreNextTarget, next: any, prev: any): void;
  emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void;
  emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void;
  emitRowOpsOptimistic(t: StoreNextTarget, next: any[] | null, ops: RowOps | null): void;
  emitSlotPatch(t: StoreNextTarget, index: number, next: any, prev: any): void;
  emitRowOps(t: StoreNextTarget, next: any[], ops: RowOps): void;
  emitSetterRowOps(t: StoreNextTarget, prevRows: any[], nextRows: any[]): void;
  hasPatches(): boolean;
}

export let patchHooks: PatchHooks | null = null;

export function installPatchHooks(hooks: PatchHooks): void {
  patchHooks = hooks;
}
