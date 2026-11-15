/**
 * Store — the engine's optional-machinery slots, in a module of their own so
 * an installer reaches them without importing store.ts (whose top level
 * installs the engine): the store half of `affects()` installs through here
 * from `affects()`, and an app without stores carries none of the engine.
 * A slot no installer reaches stays `null`, and a bundler folds its sites.
 */
import type { Transaction } from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { StoreFamily, StoreTarget } from "./target.js";

/** The store half of `affects()` (store/affects.ts), installed by the first
 * store-targeted declaration: a node born on a covered record inherits the
 * live mark; an untracked verdict probe through a record with no node is
 * witnessed. */
export interface AffectsHooks {
  _born(t: StoreTarget, node: Signal<any>, key: PropertyKey): void;
  _witness(t: StoreTarget, key: PropertyKey | undefined): void;
}
export let affectsHooks: AffectsHooks | null = null;
export function installAffectsHooks(hooks: AffectsHooks): void {
  affectsHooks = hooks;
}
