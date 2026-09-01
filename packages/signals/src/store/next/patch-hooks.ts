import type { StoreNextTarget } from "./target.js";

/**
 * REGION-DELIVERY BRANCH: the patch channel is GUTTED here (graph-native
 * regions replace it; the driver branch remains the independent
 * comparison). The hook seams stay as typed null constants so every
 * guarded emission site in store/reconcile/optimistic compiles unchanged
 * and minifies away as dead branches — the same tree-shaking mechanism
 * the pay-for-use design used, now permanent.
 */
export interface RowOps {
  prefix: number;
  sources: number[];
  removed: any[];
}

export interface PatchValueHooks {
  emitPatch(t: StoreNextTarget, next: any, prev: any): void;
  emitPatchLocal(t: StoreNextTarget, next: any, prev: any): void;
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

export const patchHooks: PatchValueHooks | null = null;
export const rowHooks: PatchRowHooks | null = null;
