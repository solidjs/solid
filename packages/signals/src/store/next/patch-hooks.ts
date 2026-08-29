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
  /** Lane-timed twin + settle-held staging for TENTATIVE walks (re-audit
   * 8, P1-3): pass the active transaction so revert/landing re-applies. */
  emitPatchAncestorsOptimistic(t: StoreNextTarget, tx: unknown): void;
  emitPatchOptimistic(t: StoreNextTarget, next: any, prev: any): void;
  hasPatches(): boolean;
  demoteToEffects(t: StoreNextTarget, immediate?: boolean): void;
  /** Pre-merge clone hook for in-place (overlay) folds — see
   * prepareInPlaceFold (reference baselines clone just-in-time). */
  prepareInPlaceFold(t: StoreNextTarget): void;
}

export interface PatchRowHooks {
  emitRowOps(t: StoreNextTarget, next: any[], ops: RowOps): void;
  emitSlotPatch(t: StoreNextTarget, index: number, next: any, prev: any): void;
  emitSetterRowOps(t: StoreNextTarget, prevRows: any[], nextRows: any[]): void;
  emitRowOpsOptimistic(t: StoreNextTarget, next: any[] | null, ops: RowOps | null): void;
}

/** Raw→proxy wrap for captured structural rows (re-audit 8, P1-2).
 * Installed by createTarget — patch.ts must not import wrapNext directly:
 * that edge retains the whole trap/write engine in store-less bundles that
 * merely compiled a rowProof list (~3.7 kB brotli). If no target was ever
 * created, no raw can resolve — the null hook passes raws through. */
export let wrapRecordHook:
  | ((value: any, parent: StoreNextTarget, parentKey: PropertyKey | null, fam: any) => any)
  | null = null;

export function installWrapRecordHook(fn: NonNullable<typeof wrapRecordHook>): void {
  wrapRecordHook = fn;
}

export let patchHooks: PatchValueHooks | null = null;
export let rowHooks: PatchRowHooks | null = null;

export function installPatchHooks(hooks: PatchValueHooks): void {
  patchHooks = hooks;
}

export function installRowHooks(hooks: PatchRowHooks): void {
  rowHooks = hooks;
}
