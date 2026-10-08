/**
 * Store — the engine's optional-machinery slots, in a module of their own so
 * an installer reaches them without importing store.ts (whose top level
 * installs the engine): the store half of `affects()` installs through here
 * from `affects()`, and an app without stores carries none of the engine.
 * A slot no installer reaches stays `null`, and a bundler folds its sites.
 */
import type { Signal } from "../core/types.js";
import type { StoreTarget } from "./target.js";

/** The optimistic machinery (optimistic.ts, S4), installed when it loads
 * — a plain store pays nothing for it (#2883): the plain paths reach it
 * only through a family with `opt` set, which only `createOptimisticStore`
 * sets. */
export interface OptHooks {
  /** A user setter's draft on an optimistic family: a clone of the
   * writer's view (a staging already on the target is set aside). */
  draft(t: StoreTarget): Record<PropertyKey, any>;
  /** The setter's exit: the draft becomes guesses; returns the staging the
   * draft set aside (`null`: none). */
  writes(t: StoreTarget, pb: Record<PropertyKey, any>): Record<PropertyKey, any> | null;
  /** `src` with the lanes' values over it (`writer`: the next write's base
   * — the unflushed guesses too). */
  view(t: StoreTarget, src: Record<PropertyKey, any>, writer?: boolean): Record<PropertyKey, any>;
  /** An untracked `key in store`: the presence guess, or `undefined`. */
  has(t: StoreTarget, key: PropertyKey): boolean | undefined;
  /** A guessed key's descriptor (`null`: removed; `undefined`: no guess). */
  descriptor(t: StoreTarget, key: PropertyKey): PropertyDescriptor | null | undefined;
  /** The flush's commit: targets no lane holds leave `overlaid`. */
  sweep(): void;
  /** The container comparator's lane arm: an arrangement guess against a
   * landing (or another arrangement), by row identity. */
  arrangement(t: StoreTarget, a: any, b: any): boolean;
  /** A user's `reconcile` on an optimistic family: the keyed diff written
   * into the draft. */
  reconcile(draft: any, incoming: any, keyFn: ((item: any) => any) | null): void;
}
export let optHooks: OptHooks | null = null;
export function installOptHooks(hooks: OptHooks): void {
  optHooks = hooks;
}

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
