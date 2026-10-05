/**
 * Store — public types, brand symbols, wrappability and raw marking. Shared
 * by every store module; carries no reactive machinery of its own.
 */
import type { Refreshable } from "../core/index.js";
import { lookupTarget } from "./target.js";

/** A reactive view of a store's value. Update it through the paired `StoreSetter`. */
export type Store<T> = T;

/**
 * A store setter. The callback receives a writable **draft** of the store.
 *
 * - **Mutate in place (canonical):** `s.foo = 1`, `s.list.push(x)`,
 *   `s.list.splice(i, 1)`. This is the default form for most updates.
 * - **Return a new value:** for shapes where mutation is awkward, most
 *   commonly removing items (`s => s.list.filter(...)`). Arrays are replaced
 *   by index (length adjusted); objects are shallow-diffed at the top level
 *   (keys present in the returned value are written, missing keys deleted).
 *
 * The setter does **not** perform keyed reconciliation. If you need surviving
 * items to keep their store identity across full-array replacement, use the
 * projection form — `createStore(fn, seed, { key })` or
 * `createProjection(fn, seed, { key })` — whose derive function reconciles
 * its return by `options.key`.
 */
export type StoreSetter<T> = (fn: (state: T) => T | void) => void;
/** Tuple returned by the plain `createStore(initialValue, options?)` form. */
export type StoreReturn<T> = [get: Store<T>, set: StoreSetter<T>];
/** Tuple returned by the derived `createStore(fn, seed, options?)` form. */
export type ProjectionStoreReturn<T> = [get: Refreshable<Store<T>>, set: StoreSetter<T>];

/** Options shared by all store primitives. */
export interface StoreOptions {
  /**
   * Debug name (dev and observe builds). Property nodes are labelled
   * `<name>.<key>` in attribution output (`todos.title`); a derived store's
   * projection node carries the name itself.
   */
  name?: string;
  /** Single-layer store: root keys reactive, values raw records replaced by reference */
  shallow?: boolean;
}

/**
 * Options for derived/projected stores created with
 * `createStore(fn, seed, options?)`, `createProjection(fn, seed, options?)`,
 * or `createOptimisticStore(fn, seed, options?)`.
 */
export interface ProjectionOptions extends StoreOptions {
  /** Key property name or function for reconciliation identity; `null` merges positionally */
  key?: string | ((item: NonNullable<any>) => any) | null;
  /**
   * Treat the seed as commit #0: the store is born committed with the seed's
   * contents, shown until the derive's first real answer lands. While that
   * first answer is in flight, reads serve the seed everywhere — nothing
   * suspends to a `<Loading>` boundary, no transition is held, and
   * `isPending` stays false (the seed answers by declaration; first-load
   * affordances belong to the data, e.g. a `skeleton: true` field in the
   * seed). Once the first answer lands (reconciled into the seed), refetches
   * use normal pending semantics with `isPending` true.
   *
   * The store equivalent of `MemoOptions.loadingValue`; the seed already
   * carries the placeholder shape, so this is just the opt-in.
   */
  seedLoadingValue?: boolean;
}

export type NoFn<T> = T extends Function ? never : T;

/** Brand keys the proxy answers directly (never user data). */
export const $TRACK = Symbol(__DEV__ ? "STORE_TRACK" : 0),
  $TARGET = Symbol(__DEV__ ? "STORE_TARGET" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0),
  $RECORD = Symbol(__DEV__ ? "VIEW_RECORD" : 0);

/** The store proxy behind a projection draft wrapper (internal only). */
export const $DRAFT_INNER = Symbol(__DEV__ ? "STORE_DRAFT_INNER" : 0);

export namespace SolidStore {
  export interface Unwrappable {}
}

export type NotWrappable =
  | string
  | number
  | bigint
  | symbol
  | boolean
  | Function
  | null
  | undefined
  | SolidStore.Unwrappable[keyof SolidStore.Unwrappable];

// ---------------------------------------------------------------------------
// raw marking (R42 / RUL-12: a value is never both wrapped and raw)

const rawValues = new WeakSet<object>();
export let rawValuesUsed = false;

export function isRawValue(value: any): boolean {
  return rawValuesUsed && rawValues.has(value);
}

/** Mark a value so no store ever wraps it (sticky; it reads as a leaf). */
export function markRaw<T>(value: T): T {
  if (isWrappable(value)) {
    rawValuesUsed = true;
    rawValues.add(value as object);
  }
  return value;
}

/** A shallow store's ingested record: raw by contract (values served
 * verbatim, slots replaced by reference). */
export function markRawOne(v: any): void {
  if (isWrappable(v)) {
    if (v[$TARGET] !== undefined) return;
    if (__DEV__ && lookupTarget(v, null) !== undefined)
      throw new Error(
        "shallow store: an ingested record is already tracked as a deep store — one value cannot present both wrapped and raw"
      );
    rawValuesUsed = true;
    rawValues.add(v);
  }
}

export function markRawIngest(container: any): void {
  if (Array.isArray(container)) {
    for (let i = 0, len = container.length; i < len; i++) markRawOne(container[i]);
  } else {
    for (const k in container) markRawOne(container[k]);
  }
}

// ---------------------------------------------------------------------------
// wrappability

const OBJECT_PROTO = Object.prototype;
const wrappableProtos = new WeakMap<object, boolean>();

/** Plain objects and arrays wrap; class instances, DOM nodes, frozen objects
 * and markRaw'd values are leaves. Per-prototype verdict cached. */
export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  if (obj == null || typeof obj !== "object" || Object.isFrozen(obj)) return false;
  const proto = Object.getPrototypeOf(obj);
  if (proto === OBJECT_PROTO || proto === null) return true;
  if (Array.isArray(obj)) return true;
  let wrappable = wrappableProtos.get(proto);
  if (wrappable === undefined) {
    wrappable =
      Object.prototype.toString.call(obj) === "[object Object]" &&
      (typeof Node === "undefined" || !(obj instanceof Node));
    wrappableProtos.set(proto, wrappable);
  }
  return wrappable;
}

export function ownEnumerableKeys(o: object): (string | symbol)[] {
  return Reflect.ownKeys(o).filter(k => Object.prototype.propertyIsEnumerable.call(o, k));
}

// ---------------------------------------------------------------------------
// write override: a projection's draft ops carry it (the derive is the
// author — its writes must land outside the sync setter scope too, in a
// continuation after an `await`/`yield`). Projections return in S3; the
// traps already honour it.

export let writeOverride = false;
export function setWriteOverride(value: boolean): void {
  writeOverride = value;
}
