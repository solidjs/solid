import { STATUS_PENDING, STATUS_UNINITIALIZED, unwrapOverride } from "../core/constants.js";
import {
  pendingCheckActive,
  snapshotCaptureActive,
  snapshotSources,
  strictRead
} from "../core/core.js";
import {
  DEV,
  registerGraph,
  throwPendingUntrackedRead,
  warnStrictReadUntracked
} from "../core/dev.js";
import {
  $REFRESH,
  getObserver,
  getOwner,
  isEqual,
  NO_SNAPSHOT,
  NOT_PENDING,
  NotReadyError,
  read,
  setSignal,
  signal,
  STORE_SNAPSHOT_PROPS,
  suppressComputedRecompute,
  untrack,
  type Computed,
  type Refreshable,
  type Signal
} from "../core/index.js";
import {
  activeTransition,
  GlobalQueue,
  globalQueue,
  projectionWriteActive,
  registerTransientStoreNode,
  type Transition
} from "../core/scheduler.js";
import { createProjectionInternal } from "./projection.js";

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
  /** Key property name or function for reconciliation identity */
  key?: string | ((item: NonNullable<any>) => any);
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

export const STORE_VALUE = "v",
  STORE_OVERRIDE = "o",
  STORE_OPTIMISTIC_OVERRIDE = "x",
  STORE_NODE = "n",
  STORE_HAS = "h",
  STORE_CUSTOM_PROTO = "c",
  STORE_WRAP = "w",
  STORE_LOOKUP = "l",
  STORE_FIREWALL = "f",
  STORE_OPTIMISTIC = "p",
  STORE_OPTIMISTIC_OWNERS = "t",
  STORE_PARENT = "u",
  STORE_DESC = "d";
const STORE_SELF_PENDING = Symbol(__DEV__ ? "STORE_SELF_PENDING" : 0);

export type StoreNode = {
  [$PROXY]: any;
  [STORE_VALUE]: Record<PropertyKey, any>;
  [STORE_OVERRIDE]?: Record<PropertyKey, any>;
  [STORE_OPTIMISTIC_OVERRIDE]?: Record<PropertyKey, any>;
  // Per-key transition ownership of the optimistic layer (#2899): stamped at
  // write time so a settling action only consumes its own entries. `null` =
  // ambient write (clears at flush end). Nodes already get this granularity
  // via _optimisticNodes; this is the layer's half.
  [STORE_OPTIMISTIC_OWNERS]?: Record<PropertyKey, Transition | null>;
  [STORE_NODE]?: DataNodes;
  [STORE_HAS]?: DataNodes;
  [STORE_CUSTOM_PROTO]?: boolean;
  [STORE_WRAP]?: (value: any, target?: StoreNode) => any;
  [STORE_LOOKUP]?: WeakMap<any, any>;
  [STORE_FIREWALL]?: Computed<any>;
  [STORE_OPTIMISTIC]?: boolean;
  [STORE_SNAPSHOT_PROPS]?: Record<PropertyKey, any>;
  // Wrap-time back-link to the target this one was first wrapped under.
  // Serves node-presence bubbling (#2902); roots and store-in-store roots
  // have none. First wrapper wins — diamond reachability is untracked.
  [STORE_PARENT]?: StoreNode;
  // Sticky "this subtree (self included) carries signal nodes" flag, set by
  // getNode and bubbled up STORE_PARENT. Reconcile's object diff descends
  // into node-less children only when this is set, so never-subscribed
  // branches stay pruned (#2902). Never cleared: precision degrades toward
  // over-descent only for subscribe-then-unsubscribe churn.
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

export function createStoreProxy<T extends object>(
  value: T,
  traps: ProxyHandler<StoreNode> = storeTraps,
  extend?: (target: StoreNode) => void
) {
  let newTarget;
  if (Array.isArray(value)) {
    newTarget = [];
    newTarget.v = value;
  } else {
    newTarget = { v: value };
    const unwrapped = (value as any)?.[$TARGET]?.[STORE_VALUE] ?? value;
    const proto = Object.getPrototypeOf(unwrapped);
    if (proto !== null && proto !== Object.prototype) {
      newTarget[STORE_CUSTOM_PROTO] = true;
    }
  }
  extend && extend(newTarget);
  return (newTarget[$PROXY] = new Proxy(newTarget, traps));
}

export const storeLookup = new WeakMap();
// Node records that hold at least one user (non-`$TRACK`) symbol-keyed node.
// Lets reconcile enumerate symbols only for records that need it (#2851).
export const symbolKeyedRecords = new WeakSet<object>();
export function wrap<T extends Record<PropertyKey, any>>(value: T, target?: StoreNode): T {
  if (target?.[STORE_WRAP]) {
    const p = target[STORE_WRAP](value, target);
    const t: StoreNode | undefined = p[$TARGET];
    if (t && !t[STORE_PARENT] && t !== target) t[STORE_PARENT] = target;
    return p;
  }
  let p = value[$PROXY] || storeLookup.get(value);
  if (!p) {
    storeLookup.set(value, (p = createStoreProxy(value)));
    if (target) p[$TARGET][STORE_PARENT] = target;
  }
  return p;
}

export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  if (obj == null || typeof obj !== "object" || Object.isFrozen(obj)) return false;
  // Dynamic Node check (kept dynamic so test/SSR overrides of `globalThis.Node`
  // are observed at call time).
  return typeof Node === "undefined" || !(obj instanceof Node);
}
let writeOverride = false;
export function setWriteOverride(value: boolean) {
  writeOverride = value;
}

function writeOnly(proxy: any) {
  return writeOverride || !!Writing?.has(proxy);
}

function unwrapStoreValue(value: any, map?: Map<any, any>, lookup?: WeakMap<any, any>) {
  const target = value?.[$TARGET] || lookup?.get(value)?.[$TARGET];
  if (!target) return value;
  const override = target[STORE_OVERRIDE];
  if (!override) return target[STORE_VALUE];
  if (!map) map = new Map();
  if (map.has(value)) return map.get(value);

  const source = target[STORE_VALUE];
  const isArray = Array.isArray(source);
  const result = isArray ? [] : Object.create(Object.getPrototypeOf(source));
  map.set(value, result);
  lookup = target[STORE_LOOKUP] ?? storeLookup;

  for (const key of getStoreKeys(source, override)) {
    if (isArray && key === "length") continue;
    const next = key in override ? override[key] : source[key];
    if (next !== $DELETED) result[key] = unwrapStoreValue(next, map, lookup);
  }
  if (isArray) result.length = override.length ?? source.length;
  return result;
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
 * Single chokepoint for the store's layered value resolution: returns the
 * override layer (optimistic first, then regular) that shadows `property`, or
 * `undefined` when the base `STORE_VALUE` is authoritative. Every trap must
 * resolve through this — hand-inlining the layer order is how the optimistic
 * layer gets missed (#2850).
 */
export function getOverlayLayer(
  target: StoreNode,
  property: PropertyKey
): Record<PropertyKey, any> | undefined {
  const opt = target[STORE_OPTIMISTIC_OVERRIDE];
  if (opt && property in opt) return opt;
  const override = target[STORE_OVERRIDE];
  if (override && property in override) return override;
  return undefined;
}

/**
 * The value a store leaf's backing signal currently shows to readers: active
 * override, else held pending value, else committed value.
 */
export function visibleNodeValue(node: DataNode): any {
  return node._overrideValue !== undefined && node._overrideValue !== NOT_PENDING
    ? unwrapOverride(node._overrideValue)
    : node._pendingValue !== NOT_PENDING
      ? node._pendingValue
      : node._value;
}

function hasOwnStoreProperty(target: StoreNode, property: PropertyKey) {
  // Override layers are null-prototype objects, so `in` is an own check.
  const layer = getOverlayLayer(target, property);
  if (layer) return layer[property] !== $DELETED;
  return Object.prototype.hasOwnProperty.call(unwrapStoreValue(target[STORE_VALUE]), property);
}

function hasInheritedAccessor(source: Record<PropertyKey, any>, property: PropertyKey): boolean {
  let current = Object.getPrototypeOf(source);
  while (current && current !== Object.prototype) {
    const desc = Reflect.getOwnPropertyDescriptor(current, property);
    if (desc) return !!desc.get;
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function getNodes(target: StoreNode, type: typeof STORE_NODE | typeof STORE_HAS): DataNodes {
  let nodes = target[type];
  if (!nodes) target[type] = nodes = Object.create(null) as DataNodes;
  return nodes;
}

function getNode<T>(
  target: StoreNode,
  nodes: DataNodes,
  property: PropertyKey,
  value: T,
  equals: false | ((a: any, b: any) => boolean) = isEqual,
  snapshotProps?: Record<PropertyKey, any>
): DataNode {
  if (nodes[property]) return nodes[property]!;
  const s = signal<T>(
    value,
    {
      equals: equals,
      unobserved() {
        if (nodes[property] === s) {
          delete nodes[property];
          // Drop the symbol-record mark once the last user symbol node is
          // gone, so reconcile's fast path stops probing a now string-only
          // record. Runs only on symbol-node cleanup (cold), never on reconcile.
          if (
            typeof property === "symbol" &&
            property !== $TRACK &&
            property !== $AFFECTS &&
            symbolKeyedRecords.has(nodes)
          ) {
            const syms = Object.getOwnPropertySymbols(nodes);
            let hasUserSymbol = false;
            for (let i = 0, len = syms.length; i < len; i++) {
              if (syms[i] !== $TRACK && syms[i] !== $AFFECTS) {
                hasUserSymbol = true;
                break;
              }
            }
            if (!hasUserSymbol) symbolKeyedRecords.delete(nodes);
          }
        }
      }
    },
    target[STORE_FIREWALL] as Computed<T> | undefined
  );
  if (target[STORE_OPTIMISTIC]) {
    s._overrideValue = NOT_PENDING;
  }
  if (snapshotProps && property in snapshotProps) {
    const sv = snapshotProps[property];
    s._snapshotValue = sv === undefined ? NO_SNAPSHOT : sv;
    snapshotSources?.add(s);
  }
  if (typeof property === "symbol" && property !== $TRACK && property !== $AFFECTS)
    symbolKeyedRecords.add(nodes);
  // A node born inside a live mark's identity scope inherits the mark
  // (the declaration walk could only cover nodes that existed then). The
  // record's own $AFFECTS carrier is the mark's channel, never a member.
  if (property !== $AFFECTS && affectsScopes.size)
    inheritAffectsMarks(s, target[STORE_VALUE], property);
  // Node presence bubbles up the wrap chain (sticky), so reconcile can see
  // "subscribers live somewhere below" through node-less intermediate
  // records — the captured-proxy diff gate (#2902). Amortized O(1): stops at
  // the first already-flagged ancestor.
  let t: StoreNode | undefined = target;
  while (t && !t[STORE_DESC]) {
    t[STORE_DESC] = true;
    t = t[STORE_PARENT];
  }
  return (nodes[property] = s);
}

/**
 * Scope inheritance for late-created nodes: every live mark whose identity
 * scope contains the owning record's raw — and, for keyed marks, whose key
 * is this property — gets counted on the new node. Inherited marks live
 * exactly as long as the scope's carrier — the release hook below drops
 * them with the entry.
 */
function inheritAffectsMarks(node: DataNode, raw: object, property: PropertyKey): void {
  // A live scope exists, so affects.ts already installed the mark engine.
  for (const [carrier, entry] of affectsScopes) {
    if (
      carrier._affectsCount &&
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
  const target: StoreNode | undefined =
    value[$TARGET] || (lookup ?? storeLookup).get(value)?.[$TARGET];
  const raw = target ? target[STORE_VALUE] : value;
  if (visited.has(raw)) return;
  visited.add(raw);
  entry.scope.add(raw);
  let override: Record<PropertyKey, any> | undefined;
  if (target) {
    collectRecordNodes(target[STORE_NODE], found);
    collectRecordNodes(target[STORE_HAS], found);
    override = mergedOverlay(target);
    // Carry the effective lookup into untouched descendants. Default stores
    // use the global lookup just like snapshotImpl; without it, nested raw
    // objects fall back to string-only enumeration and symbol branches vanish.
    lookup = target[STORE_LOOKUP] ?? lookup ?? storeLookup;
  }
  if (Array.isArray(raw)) {
    const len = override?.length ?? raw.length;
    for (let i = 0; i < len; i++) {
      const v = override && i in override ? override[i] : raw[i];
      if (v !== $DELETED) walkAffectsScope(v, entry, found, lookup, visited);
    }
    // Arrays can also carry symbol metadata. Enumerate symbols separately to
    // avoid scanning large index lists twice. Outside a store tree, retain the
    // existing index-only walk.
    const symbols = target || lookup ? getStoreSymbols(raw, override) : [];
    for (let i = 0, l = symbols.length; i < l; i++) {
      const key = symbols[i];
      const desc = getPropertyDescriptor(raw, override, key);
      if (!desc || desc.get) continue;
      walkAffectsScope(desc.value, entry, found, lookup, visited);
    }
  } else {
    const keys = target || lookup ? getStoreKeys(raw, override) : getKeys(raw, override);
    for (let i = 0, l = keys.length; i < l; i++) {
      const desc = getPropertyDescriptor(raw, override, keys[i]);
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
  if (own?._affectsCount) GlobalQueue._witnessAffects!(own);
  if (affectsScopes.size) {
    const raw = target[STORE_VALUE];
    for (const [carrier, entry] of affectsScopes) {
      if (
        carrier !== own &&
        carrier._affectsCount &&
        entry.scope.has(raw) &&
        (entry.key === undefined || entry.key === property)
      )
        GlobalQueue._witnessAffects!(carrier);
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
  const nodes = getNodes(target, STORE_NODE);
  GlobalQueue._releaseAffectsScope ||= node => {
    const entry = affectsScopes.get(node as DataNode);
    if (!entry) return;
    affectsScopes.delete(node as DataNode);
    for (let i = 0; i < entry.inherited.length; i++)
      GlobalQueue._releaseAffectsMark!(entry.inherited[i]);
  };
  if (key === undefined) {
    const carrier = getNode(target, nodes, $AFFECTS, undefined, false);
    let entry = affectsScopes.get(carrier);
    if (!entry) affectsScopes.set(carrier, (entry = { scope: new Set(), inherited: [] }));
    const result = [carrier];
    walkAffectsScope(target[$PROXY], entry, result, target[STORE_LOOKUP], new Set());
    return result;
  }
  let node = nodes[key];
  if (!node) {
    const layer = getOverlayLayer(target, key);
    const raw = layer ? layer[key] : target[STORE_VALUE][key];
    node = upsertStoreNode(
      target,
      nodes,
      key,
      raw === $DELETED ? undefined : raw,
      target[STORE_SNAPSHOT_PROPS]
    );
  }
  // Keyed marks resolve by identity too (#2904): another store family's
  // proxy can share this record's raw (a derived store swaps its backing to
  // the source's raw when its projection lands), and reads through it never
  // touch this target's node map. Scope is exactly the owning record's raw,
  // narrowed to this key for witness and birth inheritance.
  let entry = affectsScopes.get(node);
  if (!entry) affectsScopes.set(node, (entry = { scope: new Set(), inherited: [], key }));
  entry.scope.add(target[STORE_VALUE]);
  return [node];
}

export function trackSelf(target: StoreNode, symbol: symbol = $TRACK) {
  if (!getObserver()) return;
  read(getNode(target, getNodes(target, STORE_NODE), symbol, undefined, false));
  // Store-in-store: structural notifications (reconcile, notifySelf) land on
  // the wrapped source's own self-node, never on this wrapper view's. Chain
  // the read through so enumeration/$TRACK on the wrapper observes them
  // (#2864). Property reads already chain naturally via the inner get trap.
  // An override layer on the view is a hold (A17) — the shown structure is
  // the overlay's, so don't subscribe through it; clearing the layer notifies
  // this view's own self-node and the re-run re-establishes the chain.
  if (
    symbol === $TRACK &&
    !target[STORE_OVERRIDE] &&
    !target[STORE_OPTIMISTIC_OVERRIDE] &&
    target[STORE_VALUE][$TARGET]
  )
    (target[STORE_VALUE] as any)[$TRACK];
}

export function notifySelf(target: StoreNode) {
  const node = target[STORE_NODE]?.[$TRACK];
  node &&
    setSignal(
      node,
      target[STORE_OPTIMISTIC] && !projectionWriteActive ? STORE_SELF_PENDING : undefined
    );
}

/**
 * The write overlay a walk must read through: optimistic writes shadow
 * regular pending writes, the same resolution order as every proxy trap and
 * `reconcile` (#2850). Merging allocates only in the rare both-present case
 * (a derived optimistic store with an in-flight projection commit).
 */
export function mergedOverlay(target: StoreNode): Record<PropertyKey, any> | undefined {
  const override = target[STORE_OVERRIDE];
  const opt = target[STORE_OPTIMISTIC_OVERRIDE];
  return override && opt ? { ...override, ...opt } : (opt ?? override);
}

function getKeysImpl(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined,
  enumerable: boolean,
  symbols: boolean
): PropertyKey[] {
  // Plain objects can't trigger proxy traps — only pay for the untrack
  // closure when the source is itself a wrapped store (store-in-store).
  const baseKeys = (source as any)[$TARGET]
    ? untrack(() =>
        enumerable
          ? symbols
            ? ownEnumerableKeys(source)
            : Object.keys(source)
          : Reflect.ownKeys(source)
      )
    : enumerable
      ? symbols
        ? ownEnumerableKeysPlain(source)
        : Object.keys(source)
      : Reflect.ownKeys(source);
  return override ? mergeOverrideKeys(baseKeys, override) : baseKeys;
}

export function getKeys(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined,
  enumerable: boolean = true
): PropertyKey[] {
  return getKeysImpl(source, override, enumerable, false);
}

export function getStoreKeys(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined
): PropertyKey[] {
  return getKeysImpl(source, override, true, true);
}

export function getStoreSymbols(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined
): symbol[] {
  const symbols = (source as any)[$TARGET]
    ? untrack(() => ownEnumerableSymbols(source))
    : ownEnumerableSymbols(source);
  return override ? (mergeOverrideKeys(symbols, override, true) as symbol[]) : symbols;
}

// Shared override-layer merge for key enumeration: adds live override keys,
// drops $DELETED ones. `symbolsOnly` scopes the override scan for the
// array-metadata passes.
function mergeOverrideKeys(
  baseKeys: PropertyKey[],
  override: Record<PropertyKey, any>,
  symbolsOnly?: boolean
): PropertyKey[] {
  const keys = new Set(baseKeys);
  const overrides = symbolsOnly
    ? Object.getOwnPropertySymbols(override)
    : Reflect.ownKeys(override);
  for (const key of overrides) {
    if (override[key] !== $DELETED) keys.add(key);
    else keys.delete(key);
  }
  return Array.from(keys);
}

export function getPropertyDescriptor(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined,
  property: PropertyKey
): PropertyDescriptor | undefined {
  if (override && property in override) {
    if (override[property] === $DELETED) return void 0;
    const overrideDesc = Reflect.getOwnPropertyDescriptor(override, property);
    if (overrideDesc?.get || overrideDesc?.set) return overrideDesc;
    // Plain writes live in the override while the source keeps its old value.
    // Preserve the source descriptor flags, but report the current override
    // value. Source accessors cannot be patched with a value, and inherited
    // properties have no source own descriptor, so those keep their descriptor.
    const baseDesc = Reflect.getOwnPropertyDescriptor(source, property);
    if (!baseDesc) return overrideDesc;
    if (baseDesc.get || baseDesc.set) return baseDesc;
    // Reflect returns a fresh descriptor, so patching in place is safe and
    // avoids an allocation on Object.keys/spread over written stores.
    baseDesc.value = override[property];
    return baseDesc;
  }
  return Reflect.getOwnPropertyDescriptor(source, property);
}

function prepareStoreWrite(target: StoreNode, store: any, property: PropertyKey) {
  if (target[STORE_OPTIMISTIC]) {
    const firewall = target[STORE_FIREWALL];
    if (firewall?._transition) {
      globalQueue.initTransition(firewall._transition);
    }
  }
  const state = target[STORE_VALUE];
  const base = state[property];
  if (
    snapshotCaptureActive &&
    typeof property !== "symbol" &&
    !((target[STORE_FIREWALL]?._statusFlags ?? 0) & STATUS_PENDING)
  ) {
    if (!target[STORE_SNAPSHOT_PROPS]) {
      target[STORE_SNAPSHOT_PROPS] = Object.create(null);
      snapshotSources?.add(target);
    }
    if (!(property in target[STORE_SNAPSHOT_PROPS]!)) {
      target[STORE_SNAPSHOT_PROPS]![property] = base;
    }
  }
  const useOptimistic = target[STORE_OPTIMISTIC] && !projectionWriteActive;
  const overrideKey = useOptimistic ? STORE_OPTIMISTIC_OVERRIDE : STORE_OVERRIDE;
  return { base, overrideKey, state };
}

/**
 * Registers the store for transition reversion. Called only once a write is
 * known to be effective — ineffective writes (same value, delete of an absent
 * property) are no-ops and must not entangle the store. Optimistic writes are
 * verdict-inert (question-scoped pending model): no mask is armed — the write
 * neither pends its own slot nor silences anyone else's.
 */
function armOptimisticStoreWrite(target: StoreNode, store: any): void {
  // STORE_OPTIMISTIC is only set by createOptimisticStore, which installs the
  // optimistic engine before wrapping.
  if (target[STORE_OPTIMISTIC] && !projectionWriteActive) {
    GlobalQueue._trackOptimisticStore!(store);
  }
}

/**
 * Records which transition owns an optimistic layer entry (#2899), so a
 * settling action only consumes its own keys — the layer is store-wide, but
 * concurrent actions writing disjoint keys must revert independently, exactly
 * like optimistic signal nodes do via the transition's _optimisticNodes.
 * `activeTransition` is the write's transaction (action() opens it before the
 * body runs); null marks an ambient write that clears at plain flush end.
 * Same-key writes across actions keep last-write-wins layer semantics.
 */
function stampOptimisticOwner(target: StoreNode, overrideKey: string, property: PropertyKey): void {
  if (overrideKey === STORE_OPTIMISTIC_OVERRIDE)
    (target[STORE_OPTIMISTIC_OWNERS] ??= Object.create(null))[property] = activeTransition;
}

function upsertStoreNode(
  target: StoreNode,
  nodes: DataNodes,
  property: PropertyKey,
  prev: any,
  snapshotProps?: Record<PropertyKey, any>
): DataNode {
  if (nodes[property]) return nodes[property]!;
  const initial = isWrappable(prev) ? wrap(prev, target) : prev;
  const node = getNode(target, nodes, property, initial, isEqual, snapshotProps);
  registerTransientStoreNode(node);
  return node;
}

function notifyStoreProperty(
  target: StoreNode,
  property: PropertyKey,
  mode: "set" | "invalidate" | "delete",
  value?: any,
  prev?: any,
  prevHas?: boolean
) {
  // Cold writes upsert a transient pending node so untracked reads batch like signals.
  // Skip for projection writes (different commit semantics) and for optimistic stores
  // (whose whole purpose is immediate visibility via STORE_OPTIMISTIC_OVERRIDE).
  const skipUpsert = projectionWriteActive || target[STORE_OPTIMISTIC];
  const newHas = mode !== "delete";
  const existingHas = target[STORE_HAS]?.[property];
  if (existingHas) {
    setSignal(existingHas, newHas);
  } else if (!skipUpsert && mode !== "invalidate" && prevHas !== newHas) {
    const hasNode = upsertStoreNode(target, getNodes(target, STORE_HAS), property, prevHas);
    setSignal(hasNode, newHas);
  }
  const nodes = getNodes(target, STORE_NODE);
  if (mode === "set") {
    if (nodes[property]) {
      setSignal(nodes[property], () => (isWrappable(value) ? wrap(value, target) : value));
    } else if (!skipUpsert) {
      const node = upsertStoreNode(target, nodes, property, prev, target[STORE_SNAPSHOT_PROPS]);
      setSignal(node, () => (isWrappable(value) ? wrap(value, target) : value));
    }
  } else if (mode === "invalidate") {
    if (nodes[property]) {
      setSignal(nodes[property], {} as any);
      delete nodes[property];
    }
  } else {
    if (nodes[property]) {
      setSignal(nodes[property], undefined);
    } else if (!skipUpsert) {
      const node = upsertStoreNode(target, nodes, property, prev, target[STORE_SNAPSHOT_PROPS]);
      setSignal(node, undefined);
    }
  }
  notifySelf(target);
}

let Writing: Set<Object> | null = null;

/**
 * A derived store's seed is a draft for the derive function, never an
 * observable value (#2897): until the firewall first resolves there is
 * nothing to read, so every consumer path throws NotReady — tracked reads
 * through their node (core read()), and the untracked fall-throughs in the
 * traps through this guard. Returning the seed leaked it; returning
 * `undefined` would break non-nullable types. Callers exempt the firewall
 * itself (the derive function works its own draft while uninitialized).
 */
function throwIfUninitialized(target: StoreNode): void {
  const firewall = target[STORE_FIREWALL];
  if (firewall && firewall._statusFlags & STATUS_UNINITIALIZED)
    throw firewall._error ?? new NotReadyError(firewall);
}

export const storeTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $TARGET) return target;
    if (property === $PROXY) return receiver;
    if (property === $REFRESH) return target[STORE_FIREWALL];
    if (pendingCheckActive) witnessAffectsMark(target, property);
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const selfRead = getObserver() === target[STORE_FIREWALL];
    const nodes = getNodes(target, STORE_NODE);
    const tracked = selfRead ? undefined : nodes[property];
    const source = target[STORE_VALUE];
    if (
      !tracked &&
      !target[STORE_OVERRIDE] &&
      !target[STORE_OPTIMISTIC_OVERRIDE] &&
      !target[STORE_CUSTOM_PROTO] &&
      !target[STORE_OPTIMISTIC] &&
      !target[STORE_SNAPSHOT_PROPS] &&
      !source[$TARGET] &&
      !(property in source) &&
      getObserver() &&
      !selfRead &&
      !writeOnly(receiver)
    ) {
      return read(getNode(target, nodes, property, undefined));
    }
    const overlay = getOverlayLayer(target, property);
    const overridden = !!overlay;
    const proxySource = !!target[STORE_VALUE][$TARGET];
    const storeValue = overlay ?? target[STORE_VALUE];
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(storeValue, property);
      if (desc && desc.get) return desc.get.call(receiver);
      if (!desc && !overridden && target[STORE_CUSTOM_PROTO]) {
        const source = unwrapStoreValue(storeValue);
        if (hasInheritedAccessor(source, property)) {
          return Reflect.get(storeValue, property, receiver);
        }
      }
    }
    if (writeOnly(receiver)) {
      if (isPrototypePollutionKey(property) && !hasOwnStoreProperty(target, property))
        return undefined;
      let value =
        tracked && (overridden || !proxySource) ? visibleNodeValue(tracked) : storeValue[property];
      value === $DELETED && (value = undefined);
      if (!isWrappable(value)) return value;
      const wrapped = wrap(value, target);
      Writing?.add(wrapped);
      return wrapped;
    }
    let value = tracked
      ? overridden || !proxySource
        ? read(nodes[property])
        : (read(nodes[property]), storeValue[property])
      : storeValue[property];
    value === $DELETED && (value = undefined);
    if (!tracked) {
      if (
        !overridden &&
        typeof value === "function" &&
        !Object.prototype.hasOwnProperty.call(storeValue, property)
      ) {
        let proto;
        return !Array.isArray(target[STORE_VALUE]) &&
          (proto = Object.getPrototypeOf(target[STORE_VALUE])) &&
          proto !== Object.prototype
          ? value.bind(storeValue)
          : value;
      } else if (getObserver() && !selfRead) {
        return read(
          getNode(
            target,
            nodes,
            property,
            isWrappable(value) ? wrap(value, target) : value,
            isEqual,
            target[STORE_SNAPSHOT_PROPS]
          )
        );
      }
    }
    if (__DEV__ && strictRead && typeof property === "string") {
      // Safeguard parity with core read() (#2897): untracked store reads skip
      // node creation (and with it read()'s PENDING_ASYNC_UNTRACKED_READ
      // check), so a derived store's in-flight firewall must be consulted
      // here — otherwise a component-body read of a refetching store silently
      // returns a value the reader can never observe updating.
      if ((target[STORE_FIREWALL]?._statusFlags ?? 0) & STATUS_PENDING)
        throwPendingUntrackedRead(strictRead, { nodeName: property });
      warnStrictReadUntracked(strictRead, {
        nodeName: property,
        data: { strictRead, property, source: "store" }
      });
    }
    // Untracked fall-through (tracked reads already threw via their node in
    // read(); the dev strictRead error above wins first for memo parity).
    if (!selfRead) throwIfUninitialized(target);
    return isWrappable(value) ? wrap(value, target) : value;
  },

  has(target, property) {
    if (property === $PROXY || property === $TRACK || property === "__proto__") return true;
    if (pendingCheckActive) witnessAffectsMark(target, property);
    const hasLayer = getOverlayLayer(target, property);
    const has = hasLayer ? hasLayer[property] !== $DELETED : property in target[STORE_VALUE];

    if (writeOnly(target[$PROXY]) || getObserver() === target[STORE_FIREWALL]) return has;
    const nodes = getNodes(target, STORE_HAS);
    // If a has-node already exists, it carries the batched presence — `read()`
    // returns `_value` (committed) for untracked reads and the pending value for
    // downstream computes. This keeps `in` consistent with value reads.
    if (nodes[property]) return read(nodes[property]);
    // No node yet: `has` reflects committed presence (no pending write could change
    // it without first upserting a has-node at the write site). Create + read only
    // when tracking; leave untracked reads node-free.
    if (getObserver()) {
      return read(getNode(target, nodes, property, has));
    }
    throwIfUninitialized(target);
    return has;
  },

  set(target, property, rawValue) {
    if (property === "__proto__") return true;
    const store = target[$PROXY];
    if (writeOnly(store)) {
      untrack(() => {
        const { base, overrideKey, state } = prepareStoreWrite(target, store, property);
        const prevLayer = getOverlayLayer(target, property);
        const prev = prevLayer ? prevLayer[property] : base;
        const prevHas = prevLayer
          ? prevLayer[property] !== $DELETED
          : property in target[STORE_VALUE];
        const value = unwrapStoreValue(rawValue);
        // Symbol-keyed writes on arrays are metadata, not index writes — never run
        // them through the numeric index/length machinery (`parseInt` on a symbol
        // throws). #2769
        const index = typeof property === "string" ? Number(property) : -1;
        const isArrayIndexWrite =
          Array.isArray(state) &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < 4294967295 &&
          String(index) === property;
        const nextIndex = isArrayIndexWrite ? index + 1 : 0;
        const len = isArrayIndexWrite && (getOverlayLayer(target, "length") ?? state).length;
        const nextLength = isArrayIndexWrite && nextIndex > len ? nextIndex : undefined;

        if (prev === value && nextLength === undefined) return true;
        armOptimisticStoreWrite(target, store);
        if (value !== undefined && value === base && nextLength === undefined) {
          delete target[overrideKey]?.[property];
          if (overrideKey === STORE_OPTIMISTIC_OVERRIDE)
            delete target[STORE_OPTIMISTIC_OWNERS]?.[property];
        } else {
          const override = target[overrideKey] || (target[overrideKey] = Object.create(null));
          override[property] = value;
          stampOptimisticOwner(target, overrideKey, property);
          if (nextLength !== undefined) {
            override.length = nextLength;
            stampOptimisticOwner(target, overrideKey, "length");
          }
        }
        notifyStoreProperty(target, property, "set", value, prev, prevHas);
        // Shrinking an array's length must remove the truncated indices, otherwise
        // they leak through `has`, `ownKeys`, and (tracked) index reads from the
        // underlying value. Mark each as deleted and notify so reactive reads update. #2768
        if (
          Array.isArray(state) &&
          property === "length" &&
          typeof value === "number" &&
          typeof prev === "number" &&
          value < prev
        ) {
          const override = target[overrideKey] || (target[overrideKey] = Object.create(null));
          for (let i = value; i < prev; i++) {
            if (override[i] === $DELETED) continue;
            const prevIndex = i in override ? override[i] : state[i];
            if (!(i in override) && !(i in state)) continue;
            override[i] = $DELETED;
            stampOptimisticOwner(target, overrideKey, i);
            notifyStoreProperty(target, i, "delete", undefined, prevIndex, true);
          }
        }
        // notify length change
        if (Array.isArray(state) && property !== "length" && nextLength !== undefined) {
          const nodes = getNodes(target, STORE_NODE);
          if (nodes.length) {
            setSignal(nodes.length, nextLength);
          } else if (!projectionWriteActive && !target[STORE_OPTIMISTIC]) {
            const node = upsertStoreNode(
              target,
              nodes,
              "length",
              len,
              target[STORE_SNAPSHOT_PROPS]
            );
            setSignal(node, nextLength);
          }
        }
        if (__DEV__) DEV.hooks.onStoreNodeUpdate?.(target[$PROXY], property, value, prev);
      });
    }
    return true;
  },

  defineProperty(target, property, descriptor) {
    if (property === "__proto__") return true;
    const store = target[$PROXY];
    if (writeOnly(store)) {
      untrack(() => {
        const { base, overrideKey } = prepareStoreWrite(target, store, property);
        armOptimisticStoreWrite(target, store);
        const normalizedDescriptor =
          "value" in descriptor
            ? {
                ...descriptor,
                value: unwrapStoreValue(descriptor.value)
              }
            : descriptor;
        Object.defineProperty(
          target[overrideKey] || (target[overrideKey] = Object.create(null)),
          property,
          normalizedDescriptor
        );
        stampOptimisticOwner(target, overrideKey, property);

        notifyStoreProperty(target, property, "invalidate");

        if (__DEV__) {
          const next =
            "value" in normalizedDescriptor
              ? normalizedDescriptor.value
              : normalizedDescriptor.get?.call(store);
          DEV.hooks.onStoreNodeUpdate?.(target[$PROXY], property, next, base);
        }
      });
    }
    return true;
  },

  deleteProperty(target, property) {
    if (property === "__proto__") return true;
    // Check both optimistic and regular override for existing $DELETED
    const optDeleted = target[STORE_OPTIMISTIC_OVERRIDE]?.[property] === $DELETED;
    const regDeleted = target[STORE_OVERRIDE]?.[property] === $DELETED;
    if (writeOnly(target[$PROXY]) && !optDeleted && !regDeleted) {
      untrack(() => {
        const useOptimistic = target[STORE_OPTIMISTIC] && !projectionWriteActive;
        const overrideKey = useOptimistic ? STORE_OPTIMISTIC_OVERRIDE : STORE_OVERRIDE;
        const prevLayer = getOverlayLayer(target, property);
        const prev = prevLayer ? prevLayer[property] : target[STORE_VALUE][property];
        if (
          property in target[STORE_VALUE] ||
          (target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE])
        ) {
          armOptimisticStoreWrite(target, target[$PROXY]);
          (target[overrideKey] || (target[overrideKey] = Object.create(null)))[property] = $DELETED;
          stampOptimisticOwner(target, overrideKey, property);
        } else if (target[overrideKey] && property in target[overrideKey]) {
          armOptimisticStoreWrite(target, target[$PROXY]);
          delete target[overrideKey][property];
          if (overrideKey === STORE_OPTIMISTIC_OVERRIDE)
            delete target[STORE_OPTIMISTIC_OWNERS]?.[property];
        } else return true;
        notifyStoreProperty(target, property, "delete", undefined, prev, true);
      });
    }
    return true;
  },

  ownKeys(target: StoreNode) {
    if (pendingCheckActive) witnessAffectsMark(target);
    if (getObserver() !== target[STORE_FIREWALL]) {
      trackSelf(target);
      // trackSelf no-ops untracked, so enumeration of an unresolved derived
      // store would otherwise leak the seed's structure (#2897). The write
      // path is exempt (like the get/has traps' writeOnly early returns):
      // the first landing's reconcile enumerates the store while
      // STATUS_UNINITIALIZED is still set — it IS the initialization.
      if (!getObserver() && !writeOnly(target[$PROXY])) throwIfUninitialized(target);
    }
    // Merge optimistic override with regular override for key enumeration
    let keys = getKeys(target[STORE_VALUE], target[STORE_OVERRIDE], false);
    if (target[STORE_OPTIMISTIC_OVERRIDE]) {
      const keySet = new Set(keys);
      for (const key of Reflect.ownKeys(target[STORE_OPTIMISTIC_OVERRIDE])) {
        if (target[STORE_OPTIMISTIC_OVERRIDE][key] !== $DELETED) keySet.add(key);
        else keySet.delete(key);
      }
      keys = Array.from(keySet);
    }
    return keys as ArrayLike<string | symbol>;
  },

  getOwnPropertyDescriptor(target: StoreNode, property: PropertyKey) {
    if (property === $PROXY) return { value: target[$PROXY], writable: true, configurable: true };
    // Check optimistic override first, but use base descriptor structure for compatibility
    if (target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]) {
      if (target[STORE_OPTIMISTIC_OVERRIDE][property] === $DELETED) return undefined;
      const optDesc = Reflect.getOwnPropertyDescriptor(target[STORE_OPTIMISTIC_OVERRIDE], property);
      if (optDesc?.get || optDesc?.set || !(property in target[STORE_VALUE])) return optDesc;
      // Get base descriptor structure, override just the value
      const baseDesc = getPropertyDescriptor(target[STORE_VALUE], target[STORE_OVERRIDE], property);
      if (baseDesc) {
        const targetDesc = Reflect.getOwnPropertyDescriptor(target, property);
        const configurable = !targetDesc || targetDesc.configurable ? true : baseDesc.configurable;
        return { ...baseDesc, configurable, value: target[STORE_OPTIMISTIC_OVERRIDE][property] };
      }
      return {
        value: target[STORE_OPTIMISTIC_OVERRIDE][property],
        writable: true,
        enumerable: true,
        configurable: true
      };
    }
    const desc = getPropertyDescriptor(target[STORE_VALUE], target[STORE_OVERRIDE], property);
    // The proxy target is an internal node object, not the original source. When the
    // source has a non-configurable property that does not also exist as non-configurable
    // on the proxy target, the proxy invariant is violated: the engine requires that a
    // property reported as non-configurable must actually be non-configurable on the
    // target object. Override configurable to true only in that case.
    if (desc && !desc.configurable) {
      const targetDesc = Reflect.getOwnPropertyDescriptor(target, property);
      if (!targetDesc || targetDesc.configurable) return { ...desc, configurable: true };
    }
    return desc;
  },

  getPrototypeOf(target) {
    return Object.getPrototypeOf(target[STORE_VALUE]);
  }
};

export function storeSetter<T extends object>(store: Store<T>, fn: (draft: T) => T | void): void {
  const prevWriting = Writing;
  Writing = new Set();
  Writing.add(store);
  try {
    const value = fn(store);
    if (value !== store && value !== undefined) {
      if (Array.isArray(value)) {
        for (let i = 0, len = value.length; i < len; i++) store[i] = value[i];
        (store as any).length = value.length;
      } else {
        const keys = new Set([...ownEnumerableKeys(store), ...ownEnumerableKeys(value)]);
        keys.forEach(key => {
          if (key in value) store[key] = (value as any)[key];
          else delete (store as any)[key];
        });
      }
    }
  } finally {
    Writing.clear();
    Writing = prevWriting;
  }
}

/**
 * Creates a deeply-reactive store backed by a Proxy. Reads track each property
 * accessed; only the parts that change trigger updates.
 *
 * Store properties hold **plain values**, not accessors. The proxy already
 * tracks reads per-property — wrapping a value in `() => state.foo` produces
 * a getter that *won't* track when called, which looks like a reactivity bug
 * but is just a category error. If you have a signal-shaped piece of state,
 * make it a property of the store (`{ foo: 1 }`) rather than nesting an
 * accessor inside (`{ foo: () => signal() }`).
 *
 * The setter takes a **draft-mutating** function — mutate the draft in place
 * (canonical). The callback may also return a new value: arrays are replaced
 * by index (length adjusted), objects are shallow-diffed at the top level
 * (keys present in the returned value are written, missing keys deleted). Use
 * the return form for shapes where mutation is awkward — most commonly
 * removing items via `filter`. The setter does **not** do keyed reconciliation;
 * for that, use the derived/projection form (or `createProjection`).
 *
 * - Plain form: `createStore(initialValue)` — wraps a value in a reactive
 *   proxy.
 * - Derived form: `createStore(fn, seed, options?)` — a *projection store*
 *   whose contents are computed by `fn(draft)`. `fn` may be sync, async, or
 *   an `AsyncIterable`; the projection's result reconciles against the
 *   existing store by `options.key` (default `"id"`) for stable identity.
 *
 * @example
 * ```ts
 * const [state, setState] = createStore({
 *   user: { name: "Ada", age: 36 },
 *   todos: [] as { id: string; text: string; done: boolean }[]
 * });
 *
 * // Canonical: mutate the draft in place.
 * setState(s => { s.user.age = 37; });
 * setState(s => { s.todos.push({ id: "1", text: "x", done: false }); });
 *
 * // Return form: reach for it when mutation is awkward.
 * setState(s => s.todos.filter(t => !t.done));               // remove items
 * setState(s => ({ ...s, user: { name: "Grace", age: 85 } })); // shallow replace
 * ```
 *
 * @example
 * ```ts
 * // Derived store — auto-fetches & reconciles by `id`.
 * const [users] = createStore(
 *   async () => fetch("/users").then(r => r.json()),
 *   [] as User[]
 * );
 * ```
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export function createStore<T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): StoreReturn<T>;
export function createStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): ProjectionStoreReturn<T>;
export function createStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): StoreReturn<T> | ProjectionStoreReturn<T> {
  const derived = typeof first === "function",
    wrappedStore = derived
      ? createProjectionInternal(first, second as NoFn<T> | Store<NoFn<T>>, options).store
      : wrap(first);

  if (__DEV__) registerGraph(wrappedStore, getOwner());

  return [
    wrappedStore,
    derived
      ? (fn: (draft: T) => void): void => {
          // Mark the projection as manually written before notifying property nodes.
          suppressComputedRecompute((wrappedStore as any)[$REFRESH]);
          storeSetter(wrappedStore, fn);
        }
      : (fn: (draft: T) => void): void => storeSetter(wrappedStore, fn)
  ];
}
