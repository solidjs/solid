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
  /** The flush's commit: targets no lane holds leave `_overlaid`. */
  sweep(): void;
  /** S2 — the carrier arms (optimistic.ts), each a no-op for a target with
   * no live guess: a key read served through the carrier (`NOT_PENDING`:
   * none), a presence read (`undefined`: none), a descriptor (`null`: the
   * key is absent in the guess; `undefined`: none), the frame an
   * enumeration reads (`NOT_PENDING`: none), whether a landing on `key`
   * is the carrier's to tell (the key's leaf is silent), and a landing's
   * truth judged against the live carriers. */
  read(t: StoreTarget, key: PropertyKey): unknown;
  has(t: StoreTarget, key: PropertyKey): boolean | undefined;
  descriptor(
    t: StoreTarget,
    key: PropertyKey,
    array: boolean
  ): PropertyDescriptor | null | undefined;
  frame(t: StoreTarget): unknown;
  covers(t: StoreTarget, key: PropertyKey, shape: boolean): boolean;
  judge(t: StoreTarget, truth: Record<PropertyKey, any>): void;
  /** A user's `reconcile` on an optimistic family: the keyed diff written
   * into the draft. */
  reconcile(draft: any, incoming: any, keyFn: ((item: any) => any) | null): void;
  /** The derive's draft wrote `pb` on `t`: the new object at a guessed
   * row's slot (by key in a keyed list) is adopted by that row's target. */
  pair(t: StoreTarget, pb: Record<PropertyKey, any>): void;
  /** The derive of `fam` went in flight (#4336): a new question asked over
   * the family's guesses is judged by its reads (`stands`) and at the seam
   * (`park`). Returns, for a `refresh()`, the leaves its wake skips. */
  ask(fam: StoreFamily): ((n: any) => unknown) | void;
  /** The flush parks with `t`: a guess a frame still reads, over a family
   * asked a new question this flush, holds `t` with its action (D-34). */
  park(t: Transaction): void;
  /** A read of `t` while its family's derive is in flight: the family's
   * guesses stand in for the flight (no suspension). */
  stands(t: StoreTarget): boolean;
}
// Set before any family is optimistic (`fam.opt`): a call site checks the
// hooks first, so a build that does not import optimistic.ts folds the arm
// away.
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
