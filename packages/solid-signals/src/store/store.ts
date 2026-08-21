import { getObserver, type Signal } from "../core/index.js";
import { ext } from "../core/core.js";
import type { Refreshable } from "../core/index.js";
import { GlobalQueue } from "../core/scheduler.js";
import { storeNextLookup } from "./next/target.js";

/** A read-only view of a store's value as seen by consumers. Mutate it via the paired `StoreSetter`. */
export type Store<T> = Readonly<T>;
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
 * projection form — `createStore(fn, seed, { key })` or `createProjection` —
 * whose derive function reconciles its return by `options.key`.
 */
export type StoreSetter<T> = (fn: (state: T) => T | void) => void;
/** Tuple returned by the plain `createStore(initialValue)` form. */
export type StoreReturn<T> = [get: Store<T>, set: StoreSetter<T>];
/** Tuple returned by the derived `createStore(fn, seed, options?)` form. */
export type ProjectionStoreReturn<T> = [get: Refreshable<Store<T>>, set: StoreSetter<T>];
/** Base options for store primitives. */
export interface StoreOptions {
  /** Debug name (dev mode only) */
  name?: string;
}
/** Options for derived/projected stores created with `createStore(fn)`, `createProjection`, or `createOptimisticStore(fn)`. */
export interface ProjectionOptions extends StoreOptions {
  /** Key property name or function for reconciliation identity; `null` merges positionally */
  key?: string | ((item: NonNullable<any>) => any) | null;
  /** Single-layer store: root keys reactive, values raw records replaced by reference */
  shallow?: boolean;
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

type DataNode = Signal<any>;
type DataNodes = Record<PropertyKey, DataNode>;

/**
 * Brand symbols used internally by the store proxy / projection plumbing.
 * Cross-package wiring; not part of the user-facing API.
 *
 * @internal
 */
export const $TRACK = Symbol(__DEV__ ? "STORE_TRACK" : 0),
  $TARGET = Symbol(__DEV__ ? "STORE_TARGET" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0),
  $DELETED = Symbol(__DEV__ ? "STORE_DELETED" : 0),
  // Node-map slot carrying a record-level `affects()` mark: any read through
  // the record witnesses it into the active isPending() probe.
  $AFFECTS = Symbol(__DEV__ ? "STORE_AFFECTS" : 0);

// Structural field names of store targets (StoreNextTarget aliases these, so
// shared machinery — affects walks, tests — reads targets via the consts).
export const STORE_VALUE = "v",
  STORE_NODE = "n",
  STORE_HAS = "h",
  STORE_PARENT = "u",
  STORE_DESC = "d",
  STORE_SHALLOW = "s";

/** Structural view of a store target as shared machinery sees it (the real
 * shape is `StoreNextTarget` in ./next/target.ts). */
export type StoreNode = {
  [$PROXY]: any;
  [STORE_VALUE]: Record<PropertyKey, any>;
  [STORE_NODE]?: DataNodes;
  [STORE_HAS]?: DataNodes;
  [STORE_PARENT]?: StoreNode;
  [STORE_SHALLOW]?: boolean;
  [STORE_DESC]?: boolean;
};

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

function lookupTarget(value: any, lookup?: WeakMap<any, any>): StoreNode | undefined {
  // Family maps (projections/optimistic) map raw -> target; the global next
  // lookup maps raw -> target too. Proxies resolve through $TARGET directly.
  if (lookup !== undefined) {
    const p = lookup.get(value);
    if (p !== undefined) return p[$TARGET] ?? p;
  }
  return storeNextLookup.get(value) as any;
}
// Values marked raw never acquire a proxy identity: wrap() serves them as-is
// everywhere — deep stores hold them as leaf values replaced by reference.
// Once raw, always raw (identity stays single, just unwrapped). Consulted
// only on wrap-creation and ingest paths; reads never touch it.
const rawValues = new WeakSet<object>();

/**
 * Marks a value as raw: no store will ever wrap it — every store presents it
 * as-is, tracked by reference at whatever slot holds it and updated by
 * replacement. Useful for class instances and external objects (editors,
 * scene graphs, Maps) and for record-shaped data updated wholesale. Sticky
 * for the value's lifetime.
 */
// Flipped on the first mark and exported as a LIVE binding: reconcile
// consults it on every recursable pair, and importing the boolean directly
// lets those sites skip even the function call when no shallow store or raw
// mark exists anywhere in the app.
export let rawValuesUsed = false;

export function isRawValue(value: any): boolean {
  return rawValuesUsed && rawValues.has(value);
}

export function markRaw<T>(value: T): T {
  if (isWrappable(value)) {
    if (__DEV__ && false) throw new Error("markRaw: value is already tracked by a store");
    rawValuesUsed = true;
    rawValues.add(value as object);
  }
  return value;
}

export function markRawOne(v: any) {
  if (isWrappable(v)) {
    // A store proxy is already tracked elsewhere: the shallow boundary passes
    // it through by reference (replaced, never edited — same slot semantics
    // as a raw) instead of claiming it raw. The sticky mark is global, so
    // marking a live proxy would make wrap() serve it verbatim through every
    // OTHER store too — downstream deep stores then captured it instead of
    // wrapping it in their own family, and their writes landed in the
    // upstream store's override layer (#2932).
    if (v[$TARGET] !== undefined) return;
    if (__DEV__ && storeNextLookup.has(v))
      throw new Error(
        "shallow store: an ingested record is already tracked as a deep store — one value cannot present both wrapped and raw"
      );
    rawValuesUsed = true;
    rawValues.add(v);
  }
}

export function markRawIngest(container: any) {
  if (Array.isArray(container)) {
    for (let i = 0, len = container.length; i < len; i++) markRawOne(container[i]);
  } else {
    for (const k in container) markRawOne(container[k]);
  }
}

const OBJECT_PROTO = Object.prototype;
// Per-prototype memo for the custom-proto branch of isWrappable: the verdict
// is fully determined by the prototype (tag and Node lineage both live on
// the chain), so each class pays the tag call once — not per read.
const wrappableProtos = new WeakMap<object, boolean>();

export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  if (obj == null || typeof obj !== "object" || Object.isFrozen(obj)) return false;
  // Plain data and user class instances wrap; platform objects never do
  // (#2952). Native code brand-checks internal slots and throws through a
  // proxy (`Map.prototype.size`, `Date.prototype.getTime`, ...), so
  // collections and other built-ins can't honestly be stores — they get the
  // markRaw-children contract automatically: served raw, mutations land raw,
  // the property holding them still tracks (reassignment notifies). The tag
  // check separates them structurally: user classes stringify as
  // `[object Object]` while every native/host object carries its own brand
  // (`[object Map]`, `[object Date]`, `[object Headers]`, ...), including
  // subclasses, which inherit the tag. getPrototypeOf keeps the hot path
  // (plain and null-proto objects) intrinsic-only — no property lookup.
  const proto = Object.getPrototypeOf(obj);
  if (proto === OBJECT_PROTO || proto === null) return true;
  if (Array.isArray(obj)) return true;
  let wrappable = wrappableProtos.get(proto);
  if (wrappable === undefined) {
    wrappable =
      Object.prototype.toString.call(obj) === "[object Object]" &&
      // Dynamic Node check (kept dynamic so test/SSR overrides of
      // `globalThis.Node` are observed at call time): shimmed DOMs implement
      // nodes as plain user classes, which pass the tag check.
      (typeof Node === "undefined" || !(obj instanceof Node));
    wrappableProtos.set(proto, wrappable);
  }
  return wrappable;
}
let writeOverride = false;
export function setWriteOverride(value: boolean) {
  writeOverride = value;
}
export function getWriteOverride(): boolean {
  return writeOverride;
}

function isPrototypePollutionKey(property: PropertyKey) {
  return property === "__proto__" || property === "constructor" || property === "prototype";
}

// Own enumerable keys including symbols (`Object.keys` drops symbol-keyed props). #2769
export function ownEnumerableKeys(o: object): (string | symbol)[] {
  return Reflect.ownKeys(o).filter(k => Object.prototype.propertyIsEnumerable.call(o, k));
}

function ownEnumerableSymbols(o: object): symbol[] {
  const symbols = Object.getOwnPropertySymbols(o);
  const result: symbol[] = [];
  for (let i = 0, len = symbols.length; i < len; i++) {
    const symbol = symbols[i];
    if (Object.prototype.propertyIsEnumerable.call(o, symbol)) result.push(symbol);
  }
  return result;
}

// Plain-object variant that keeps Object.keys() as the fast path and only pays
// descriptor checks for symbols. Do not use this on store proxies: splitting
// strings/symbols would invoke their ownKeys trap twice.
function ownEnumerableKeysPlain(o: object): (string | symbol)[] {
  return (Object.keys(o) as (string | symbol)[]).concat(ownEnumerableSymbols(o));
}

/**
 * Scope inheritance for late-created nodes: every live mark whose identity
 * scope contains the owning record's raw — and, for keyed marks, whose key
 * is this property — gets counted on the new node. Inherited marks live
 * exactly as long as the scope's carrier — the release hook below drops
 * them with the entry.
 */
export function inheritAffectsMarks(node: DataNode, raw: object, property: PropertyKey): void {
  // A live scope exists, so affects.ts already installed the mark engine.
  for (const [carrier, entry] of affectsScopes) {
    if (
      carrier._x?._affectsCount &&
      entry.scope.has(raw) &&
      (entry.key === undefined || entry.key === property)
    ) {
      GlobalQueue._markAffects!(node);
      entry.inherited.push(node);
    }
  }
}

/**
 * Live mark scopes: the mark's carrier node → the raw identities the mark
 * covers, plus the nodes created inside that scope since (inherited marks).
 * Marks cover by IDENTITY, not read path — captured or re-wrapped proxies
 * (`<For>` rows, derived stores sharing the source's raw) never traverse
 * the declaration's proxy, so coverage resolves against raw identity here
 * (#2882). Keyless marks: carrier is the record's `$AFFECTS` node and
 * `scope` holds every raw reachable at declaration. Keyed marks (#2904):
 * carrier is the slot's leaf node, `scope` holds just the owning record's
 * raw, and `key` narrows witness/inheritance to that one property. Entries
 * die with the carrier's last registration (scheduler release hook), which
 * also releases every inherited mark.
 */
interface AffectsScope {
  scope: Set<object>;
  inherited: DataNode[];
  key?: PropertyKey;
}
const affectsScopes = new Map<DataNode, AffectsScope>();

/** Next-store node factory for affects carriers/slots: injected by the
 * rewrite module (next targets alias the legacy field names, so everything
 * here EXCEPT node creation works on them structurally). */
export let nextAffectsNodeResolver: ((target: any, key: PropertyKey) => DataNode) | null = null;
export function setNextAffectsNodeResolver(fn: (target: any, key: PropertyKey) => DataNode): void {
  nextAffectsNodeResolver = fn;
}

/** Next-store optimistic view for the declaration walk (optimistic rows
 * pushed before the declaration are in motion too — legacy reads its write
 * overlays; next composes armed-node overrides). */
export let nextOptimisticViewResolver: ((target: any, raw: any) => any) | null = null;
export function setNextOptimisticViewResolver(fn: (target: any, raw: any) => any): void {
  nextOptimisticViewResolver = fn;
}

/** @internal birth inheritance for nodes created inside a live mark window —
 * exported for the rewrite's node factories. */
export function affectsScopesLive(): boolean {
  return affectsScopes.size > 0;
}

/**
 * Snapshots the identities reachable from `value` into `scope`, reading
 * through write overlays (an optimistic row pushed before the declaration is
 * in motion too). Untracked by construction: walks raw values, never traps.
 * Every LIVE node under each reachable record — property leaves, `$TRACK`,
 * and has-nodes — collects into `found`: those are the graph edges existing
 * readers subscribed through, so the mark registers on them directly and
 * rides the status rails to everything derived. (Nodes born later inherit
 * from the scope in `getNode`.)
 */
function walkAffectsScope(
  value: any,
  entry: AffectsScope,
  found: DataNode[],
  lookup: WeakMap<any, any> | undefined,
  // Cycle guard, fresh per declaration: the scope itself can't serve — a
  // re-declaration on the same carrier unions into a scope that already
  // holds the root, and must still descend to pick up records added since.
  visited: Set<object>
): void {
  if (!isWrappable(value)) return;
  const target: StoreNode | undefined = value[$TARGET] || lookupTarget(value, lookup);
  // Next targets: walk the pending backing when present (a draft's writes are
  // in motion too) and cover BOTH identities in the scope.
  let raw = target ? ((target as any).pb ?? target[STORE_VALUE]) : value;
  if (visited.has(raw)) return;
  visited.add(raw);
  entry.scope.add(raw);
  if (target && (target as any).pb) entry.scope.add(target[STORE_VALUE]);
  // Next optimistic families: enumerate the VISIBLE view (armed-node
  // overrides compose membership/values the raw doesn't carry).
  if (target && (target as any).fam?.opt && nextOptimisticViewResolver)
    raw = nextOptimisticViewResolver(target, raw);
  if (target) {
    collectRecordNodes(target[STORE_NODE], found);
    collectRecordNodes(target[STORE_HAS], found);
    // The key-set and deep-witness nodes are record-level channels: a deep()
    // probe reads ONLY these (one pair per record), so a declared affects
    // scope must mark them like any property node.
    if ((target as any).k) found.push((target as any).k);
    if ((target as any).dk) found.push((target as any).dk);
    // Carry the effective lookup into untouched descendants (family maps for
    // projections/optimistic stores; the global next lookup otherwise).
    lookup = (target as any).fam?.map ?? lookup ?? storeNextLookup;
  }
  // Overlays are gone (next has no layer): raw enumeration; the optimistic
  // view composition above already folded armed-node membership/values in.
  if (Array.isArray(raw)) {
    for (let i = 0, len = raw.length; i < len; i++) {
      walkAffectsScope(raw[i], entry, found, lookup, visited);
    }
    const symbols = Object.getOwnPropertySymbols(raw);
    for (let i = 0, l = symbols.length; i < l; i++) {
      const desc = Object.getOwnPropertyDescriptor(raw, symbols[i]);
      if (!desc || desc.get) continue;
      walkAffectsScope(desc.value, entry, found, lookup, visited);
    }
  } else {
    const keys = Reflect.ownKeys(raw);
    for (let i = 0, l = keys.length; i < l; i++) {
      const desc = Object.getOwnPropertyDescriptor(raw, keys[i]);
      if (!desc || desc.get) continue;
      walkAffectsScope(desc.value, entry, found, lookup, visited);
    }
  }
}

/** All live signal nodes of one record's node map (string + symbol keyed). */
function collectRecordNodes(nodes: DataNodes | undefined, found: DataNode[]): void {
  if (!nodes) return;
  for (const key of Object.keys(nodes)) found.push(nodes[key]);
  const syms = Object.getOwnPropertySymbols(nodes);
  for (let i = 0, l = syms.length; i < l; i++) {
    // Another mark's carrier is its own channel — counting it here would
    // extend that sibling scope's lifetime to this declaration's.
    if (syms[i] !== $AFFECTS) found.push(nodes[syms[i]]);
  }
}

/**
 * Witness live mark coverage of a record into the active isPending() probe.
 * Tracked reads don't need this — they go through real signal nodes, which
 * carry marks directly (declaration walk or birth inheritance). This covers
 * UNTRACKED probes reading through records whose nodes never materialized
 * (no observer ever subscribed, so no node exists to carry the mark).
 * Callers guard on `pendingCheckActive`, so plain reads never pay for this.
 *
 * @internal
 */
export function witnessAffectsMark(target: StoreNode, property?: PropertyKey): void {
  // Callers guard on `pendingCheckActive`, which only flips inside
  // isPending() — the verdict layer is loaded and its hook installed.
  const own = target[STORE_NODE]?.[$AFFECTS];
  if (own?._x?._affectsCount) GlobalQueue._witnessAffects!(own);
  if (affectsScopes.size) {
    // Chained backings (§7b): a wrapper's STORE_VALUE can be another store's
    // proxy — marks cover by identity of the BASE raw, so resolve the chain
    // and check every identity along it.
    let raw = target[STORE_VALUE];
    for (const [carrier, entry] of affectsScopes) {
      if (
        carrier !== own &&
        carrier._x?._affectsCount &&
        (entry.key === undefined || entry.key === property)
      ) {
        let r: any = raw;
        for (;;) {
          if (entry.scope.has(r)) {
            GlobalQueue._witnessAffects!(carrier);
            break;
          }
          const t: StoreNode | undefined = r?.[$TARGET];
          if (t === undefined) break;
          const backing = (t as any).pb ?? t[STORE_VALUE];
          if (backing === r) break;
          r = backing;
        }
      }
    }
  }
}

/**
 * Resolves the store nodes an `affects()` declaration marks: with a `key`,
 * the named slot's leaf node (upserted so the mark has an addressable
 * carrier); without, the record's $AFFECTS carrier plus every LIVE node in
 * its subtree (the edges existing readers subscribed through), with the
 * subtree's identities snapshotted into the mark's scope so nodes created
 * during the window — and untracked probes over captured proxies — resolve
 * against it (#2882).
 *
 * @internal
 */
export function getStoreAffectsNodes(target: StoreNode, key?: PropertyKey): DataNode[] {
  GlobalQueue._releaseAffectsScope ||= node => {
    const entry = affectsScopes.get(node as DataNode);
    if (!entry) return;
    affectsScopes.delete(node as DataNode);
    for (let i = 0; i < entry.inherited.length; i++)
      GlobalQueue._releaseAffectsMark!(entry.inherited[i]);
  };
  if (key === undefined) {
    const carrier = nextAffectsNodeResolver!(target, $AFFECTS);
    let entry = affectsScopes.get(carrier);
    if (!entry) affectsScopes.set(carrier, (entry = { scope: new Set(), inherited: [] }));
    const result = [carrier];
    walkAffectsScope(target[$PROXY], entry, result, (target as any).fam?.map, new Set());
    return result;
  }
  const node = (target as any).n?.[key] ?? nextAffectsNodeResolver!(target, key);
  // Keyed marks resolve by identity too (#2904): another store family's
  // proxy can share this record's raw (a derived store swaps its backing to
  // the source's raw when its projection lands), and reads through it never
  // touch this target's node map. Scope is exactly the owning record's raw,
  // narrowed to this key for witness and birth inheritance.
  let entry = affectsScopes.get(node);
  if (!entry) affectsScopes.set(node, (entry = { scope: new Set(), inherited: [], key }));
  entry.scope.add(target[STORE_VALUE]);
  if ((target as any).pb) entry.scope.add((target as any).pb);
  return [node];
}
