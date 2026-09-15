import { pendingCheckActive } from "../core/core.js";
import { SUPPORTS_PROXY } from "../core/index.js";
import { createMemo } from "../signals.js";
import { $PROXY, $TARGET, ownEnumerableKeys } from "./store.js";

function trueFn() {
  return true;
}

type DistributeOverride<T, F> = T extends undefined ? F : T;
type Override<T, U> = T extends any
  ? U extends any
    ? {
        [K in keyof T]: K extends keyof U ? DistributeOverride<U[K], T[K]> : T[K];
      } & {
        [K in keyof U]: K extends keyof T ? DistributeOverride<U[K], T[K]> : U[K];
      }
    : T & U
  : T & U;
type OverrideSpread<T, U> = T extends any
  ? {
      [K in keyof ({ [K in keyof T]: any } & { [K in keyof U]?: any } & {
        [K in U extends any ? keyof U : keyof U]?: any;
      })]: K extends keyof T
        ? Exclude<U extends any ? U[K & keyof U] : never, undefined> | T[K]
        : U extends any
          ? U[K & keyof U]
          : never;
    }
  : T & U;
type Simplify<T> = T extends any ? { [K in keyof T]: T[K] } : T;
type _Merge<T extends unknown[], Curr = {}> = T extends [
  infer Next | (() => infer Next),
  ...infer Rest
]
  ? _Merge<Rest, Override<Curr, Next>>
  : T extends [...infer Rest, infer Next | (() => infer Next)]
    ? Override<_Merge<Rest, Curr>, Next>
    : T extends []
      ? Curr
      : T extends (infer I | (() => infer I))[]
        ? OverrideSpread<Curr, I>
        : Curr;

export type Merge<T extends unknown[]> = Simplify<_Merge<T>>;

/** @internal What a source ENTRY is, decided once when the view is built
 * (`merge()` learns it while flattening; `omit()` from its argument) and
 * carried beside the entry — `MergeView.kinds[i]`, `OmitView.kind` — so no
 * read has to ask. Asking is the cost: any brand check on a Proxy is a trap
 * (`instanceof` is a `getPrototypeOf` trap, ~20 ns on a store — as much as
 * the read itself), and a merge over a store did two per read. */
export const SOURCE_PLAIN = 0; // a plain object: own keys fixed, data is data
export const SOURCE_OMIT = 1; // an `OmitView` record (only as a merge entry)
export const SOURCE_PROXY = 2; // a store or foreign proxy: everything is a trap
export const SOURCE_MEMO = 3; // a function source (merge's memo): swaps objects
export type SourceKind = 0 | 1 | 2 | 3;

const EMPTY = Object.freeze({});
// The object behind a LEAF entry (any kind but OMIT): a memo is read
// (tracked, as merge's own reads are) and a nullish result has no keys.
function leafOf(s: any, kind: SourceKind): any {
  return kind === SOURCE_MEMO ? ((s = s()) == null ? EMPTY : s) : s;
}

const $SOURCES = Symbol(__DEV__ ? "MERGE_SOURCE" : 0);
const $OMIT = Symbol(__DEV__ ? "OMIT_VIEW" : 0);
// The MergeView behind a merge proxy. `$SOURCES` answers the array; the
// record itself is reached through this symbol so the table can live on it.
const $VIEW = Symbol(__DEV__ ? "MERGE_VIEW" : 0);

/** @internal The record behind an `omit()` proxy: `source` with `hidden`
 * keys removed. It is the proxy's TARGET, so the shared handler reads it as
 * plain fields — no per-instance closures — and it is what props consumers
 * walk directly (`merge`, `spread`, `ssrElement`): a view never materializes
 * a copy, and a consumer that knows the record never goes through its traps
 * (a `getOwnPropertyDescriptor` trap per key allocates a descriptor and a
 * getter, so enumerating a proxy costs more than the copy it was avoiding).
 * `hidden` is a key list or a predicate (`omit(props, k => k[0] === "$")`).
 *
 * When `source` is a `merge()` proxy the view also carries `entries`: one
 * leaf view per flattened merge source, same filter. That is what the proxy
 * answers `$SOURCES` with, so a consumer — `merge()` re-merging it, a spread,
 * `ssrElement` — flattens `omit(merge(a, b))` to `[a', b']` and a component
 * chain of defaults + omit + spread (`merge(omit(merge(omit(props))))`)
 * collapses to the leaf objects, each with its accumulated filter, with no
 * trap round-trip per layer. A leaf may be merge's memo for a function
 * source; it is resolved on access. */
export class OmitView {
  /** see `resolvedTable` */
  table: Map<PropertyKey, any> | null | undefined = undefined;
  /** see `tableOwnKeys` / `tableDescriptor` */
  keys: (string | symbol)[] | undefined = undefined;
  descs: Map<PropertyKey, PropertyDescriptor> | undefined = undefined;
  constructor(
    public source: any,
    /** of `source` — PLAIN, PROXY (a store, or a merge proxy when `entries`
     * is set) or MEMO; never OMIT, a view over a view folds into one. */
    public kind: SourceKind,
    public hidden: Hidden,
    public entries?: OmitView[]
  ) {}
}

type Hidden = PropertyKey[] | ((key: PropertyKey) => boolean);

function isHidden(view: OmitView, key: PropertyKey): boolean {
  const h = view.hidden;
  return typeof h === "function" ? h(key) : h.includes(key);
}

// Both filters as one. Two key lists stay a key list (one `includes`, no
// closure); a predicate on either side needs a closure.
function combineHidden(a: Hidden, b: Hidden): Hidden {
  if (typeof a !== "function" && typeof b !== "function") return a.concat(b);
  return key =>
    (typeof a === "function" ? a(key) : a.includes(key)) ||
    (typeof b === "function" ? b(key) : b.includes(key));
}

// The object a view filters (see `leafOf`).
function viewSource(view: OmitView): any {
  return leafOf(view.source, view.kind);
}

// Whether a `$PROXY`-marked object is one of OUR views rather than a store
// (or a foreign proxy). Asked through `$TARGET`, which a store's `get` trap
// answers on its symbol fast path and the view traps answer first thing —
// so the question never reaches a store's generic read path (firewall gate,
// tracked key read), which is what any unknown symbol (`$SOURCES`, `$OMIT`)
// would take. Call only after `$PROXY in o` is known true.
function isView(o: any): boolean {
  return o[$TARGET] === undefined && (o[$OMIT] !== undefined || o[$VIEW] !== undefined);
}

/** @internal The `OmitView` behind an `omit()` proxy, or undefined. */
export function omitView(o: any): OmitView | undefined {
  return o != null && $PROXY in o && o[$TARGET] === undefined ? o[$OMIT] : undefined;
}

// A props SOURCE ENTRY is a plain object, a proxy (store, merge, omit — the
// last two are normally unwrapped first: `mergeView` / `omitView`), a memo,
// or an `OmitView` record, and travels with its kind. These three answer for
// an entry what `Object.keys` / `in` / `[]` answer for an object, so every
// consumer walks entries with one code path, an `OmitView` is filtered
// rather than materialized, and nothing is asked of a proxy but the read.

// Own keys of a leaf: a proxy answers through ONE `ownKeys` trap (a store's
// keeps the key set tracked; `Object.keys` on a proxy would add a descriptor
// trap per key); a plain object its enumerable string keys. What a memo
// holds is only known once read.
function leafKeys(leaf: any, kind: SourceKind): (string | symbol)[] {
  if (kind === SOURCE_PLAIN) return Object.keys(leaf);
  if (kind === SOURCE_PROXY || leaf[$PROXY] === leaf) return Reflect.ownKeys(leaf);
  return Object.keys(leaf);
}

/** @internal Own string keys of a source entry — every consumer skips
 * symbols itself. */
export function sourceKeys(s: any, kind: SourceKind): (string | symbol)[] {
  if (kind === SOURCE_OMIT) {
    const keys = leafKeys(viewSource(s), s.kind);
    const out: (string | symbol)[] = [];
    for (let i = 0; i < keys.length; i++) if (!isHidden(s, keys[i])) out.push(keys[i]);
    return out;
  }
  return leafKeys(leafOf(s, kind), kind);
}

/** @internal `key in entry`. */
export function sourceHas(s: any, kind: SourceKind, key: PropertyKey): boolean {
  if (kind === SOURCE_OMIT) return !isHidden(s, key) && key in viewSource(s);
  return key in leafOf(s, kind);
}

/** @internal `entry[key]` — the source's getter runs once, here. */
export function sourceGet(s: any, kind: SourceKind, key: PropertyKey): any {
  if (kind === SOURCE_OMIT) return isHidden(s, key) ? undefined : viewSource(s)[key];
  return leafOf(s, kind)[key];
}

// An entry whose own key set is fixed: a plain object, or a view over one.
// Not a store (its key set is a tracked signal), not a merge memo source (it
// swaps whole objects), and not any proxy that declares itself with
// `$PROXY in s` — a frames slot proxy answers `has` for every key and lists
// none, so only the `in` walk is right for it.
function entryHasStaticKeys(s: any, kind: SourceKind): boolean {
  return kind === SOURCE_PLAIN || (kind === SOURCE_OMIT && s.kind === SOURCE_PLAIN);
}

/** @internal Whether the own key set of a props object cannot change
 * reactively: a plain object, or a merge/omit view over plain objects only.
 * A consumer may then decide from `Object.getOwnPropertyDescriptor` once —
 * "no `children` key" or "a data `children`" holds for the object's lifetime,
 * so no tracking scope is needed for it (#3388). For a store, or a view with
 * a store or memo leaf, keys can appear later and the reactive path is the
 * only correct one. */
export function hasStaticKeys(o: any): boolean {
  if (!($PROXY in o)) return true;
  if (o[$TARGET] !== undefined) return false;
  const merged: MergeView | undefined = o[$VIEW];
  if (merged !== undefined) {
    const f = merged.sources,
      k = merged.kinds;
    for (let i = 0; i < f.length; i++) if (!entryHasStaticKeys(f[i], k[i])) return false;
    return true;
  }
  const view: OmitView | undefined = o[$OMIT];
  if (view === undefined) return false;
  // An omit over a merge is its filtered leaf entries.
  const entries = view.entries;
  if (entries === undefined) return view.kind === SOURCE_PLAIN;
  for (let i = 0; i < entries.length; i++) if (entries[i].kind !== SOURCE_PLAIN) return false;
  return true;
}

/**
 * Whether `o[key]` can never change for the lifetime of `o`: the key is a
 * data property of a plain object, or is absent from an object whose key set
 * is fixed. A getter, a key on a store, a memo-backed `merge()` source, or
 * any key of an object whose keys can appear later (a store) is not static.
 *
 * Looks through `merge()`/`omit()` views to the leaf that owns the key. Any
 * object will do, but props are the case it exists for: the compiler encodes
 * a literal at the call site (`as="button"`) as a data property and an
 * expression (`as={isLink() ? "a" : "button"}`) as a getter, so a component
 * library reads the caller's own static/dynamic classification of a prop at
 * runtime — identically on server and client, the compiled shape being the
 * same on both — and can take a no-computation path for the literal:
 *
 * ```tsx
 * const Tag = dynamic(() => props.as, { static: isStatic(props, "as") });
 * ```
 *
 * One descriptor lookup; no read of the value, nothing tracked.
 */
export function isStatic(o: object, key: PropertyKey): boolean {
  if ($PROXY in o) {
    // A store answers its descriptor trap with a value; through a view the
    // descriptor is truthful (see `sourceDescriptor`). A foreign proxy is
    // opaque: nothing about it is known to be fixed.
    if (viewOf(o) === undefined) return false;
    const desc = Reflect.getOwnPropertyDescriptor(o, key);
    return desc === undefined ? hasStaticKeys(o) : desc.get === undefined;
  }
  const desc = Reflect.getOwnPropertyDescriptor(o, key);
  return desc === undefined || (desc.get === undefined && desc.set === undefined);
}

function accessorDescriptor(get: () => any, enumerable = true): PropertyDescriptor {
  return { configurable: true, enumerable, get, set: trueFn };
}

/** The descriptor a consumer should see for `key` on an entry —
 * the view proxies answer `getOwnPropertyDescriptor` with it, so it tells the
 * truth through any depth of merge/omit layers.
 *
 * A DATA descriptor means "nothing reactive can hide behind this value": the
 * key is a data property of a plain-object leaf — the compiler's own
 * encoding of a static attribute. Everything else is an accessor: a getter
 * on a leaf, a key on a store proxy (its "data" is a signal), or a key on a
 * merge memo source (the whole object is reactive). That is what lets a
 * consumer skip a reactive node for a static prop at the bottom of a
 * component chain, and it is why the store case must NOT forward the store's
 * own descriptor, which reports a value.
 *
 * `configurable: true` always — the target has no such property, and the
 * Proxy invariants forbid reporting a non-configurable one. */
// `present` says the caller has already established `key in s` (a trap's
// shadowing walk did), so a store is not asked a second time.
function sourceDescriptor(
  s: any,
  kind: SourceKind,
  key: PropertyKey,
  present = false
): PropertyDescriptor | undefined {
  if (kind === SOURCE_OMIT) {
    if (isHidden(s, key)) return undefined;
    return sourceDescriptor(s.source, s.kind, key, present);
  }
  // A memo source (`merge(() => …)`) is reactive wholesale: whatever shape
  // the memo's current object has, the key is an accessor here.
  if (kind === SOURCE_MEMO) {
    return present || key in leafOf(s, kind)
      ? accessorDescriptor(() => leafOf(s, kind)[key])
      : undefined;
  }
  if (kind === SOURCE_PROXY) {
    // Another view (an omit's source may be a merge proxy) already answers
    // truthfully. A store's reported "data" is a signal, and a foreign proxy
    // (frames slot props) has no own descriptors: for both, existence is
    // `in` and the kind is accessor — one trap, and never the store's
    // descriptor path.
    if (isView(s)) return Reflect.getOwnPropertyDescriptor(s, key);
    return present || key in s ? accessorDescriptor(() => s[key]) : undefined;
  }
  const desc = Reflect.getOwnPropertyDescriptor(s, key);
  if (desc === undefined) return undefined;
  if (desc.get !== undefined || desc.set !== undefined)
    return accessorDescriptor(() => s[key], desc.enumerable);
  // The proxy target has no such key, so the descriptor must be configurable;
  // Reflect's is a fresh object, so a configurable one is handed out as is.
  if (desc.configurable) return desc;
  return { configurable: true, enumerable: desc.enumerable, writable: true, value: desc.value };
}

// Own ENUMERABLE keys, symbols included, of an entry — the user-facing key
// set (`Object.keys(merged)`), where enumerability matters (#2769).
function sourceEnumerableKeys(s: any, kind: SourceKind): (string | symbol)[] {
  if (kind === SOURCE_OMIT) {
    const keys = ownEnumerableKeys(viewSource(s));
    const out: (string | symbol)[] = [];
    for (let i = 0; i < keys.length; i++) if (!isHidden(s, keys[i])) out.push(keys[i]);
    return out;
  }
  return ownEnumerableKeys(leafOf(s, kind));
}

// The target of a merge() proxy: the flattened sources, read by one shared
// handler — like OmitView, no per-instance closures. `sources` is what
// `$SOURCES` answers.
/** @internal */
export class MergeView {
  /** key → the plain leaf that owns it (later sources win), built on first
   * read when every leaf has static keys; `null` when one doesn't. */
  table: Map<PropertyKey, any> | null | undefined = undefined;
  /** see `tableOwnKeys` / `tableDescriptor` */
  keys: (string | symbol)[] | undefined = undefined;
  descs: Map<PropertyKey, PropertyDescriptor> | undefined = undefined;
  constructor(
    public sources: any[],
    /** `kinds[i]` is what `sources[i]` is (see `SourceKind`). */
    public kinds: SourceKind[]
  ) {}
}

/** @internal The `MergeView` behind a `merge()` proxy — its flattened
 * `sources` with their `kinds` — or undefined. */
export function mergeView(o: any): MergeView | undefined {
  return o != null && $PROXY in o && o[$TARGET] === undefined ? o[$VIEW] : undefined;
}

/** @internal The record behind a merge() or omit() proxy — a `MergeView`
 * (flattened `sources` with their `kinds`) or an `OmitView` — or undefined
 * for anything else (a plain object, a store, a foreign proxy). Two fast
 * traps on a store, none on a plain object. */
export function viewOf(o: any): MergeView | OmitView | undefined {
  if (o == null || !($PROXY in o) || o[$TARGET] !== undefined) return undefined;
  const merged = o[$VIEW];
  return merged !== undefined ? merged : o[$OMIT];
}

/** @internal The resolved key table of a merge/omit view — every own key of
 * the view mapped to the plain object that owns it, in merged order (a key
 * at the position of the last source that carries it, see `tableSet`) — or
 * undefined when it has none: a leaf is a store or a memo source, whose
 * keys can change, or the object is not a view at all.
 *
 * This is the flat object the eager copy used to build, made lazily and
 * without copying: one pass over the leaves' own keys on first read, then
 * every `get`/`has`/descriptor is one lookup plus one read of the owning
 * leaf, and a consumer (`spread` rerunning its effect, `ssrElement`) walks
 * the table instead of re-deriving shadowing from the leaves each time. Own
 * keys only, as the copy's were: a plain source's key set is fixed once
 * merged (keys added to it later are not seen — the copy didn't see them
 * either). */
export function resolvedTable(o: any): Map<PropertyKey, any> | undefined {
  if (o == null || !($PROXY in o) || o[$TARGET] !== undefined) return undefined;
  const view = o[$OMIT];
  if (view !== undefined) return omitTable(view);
  const merged = o[$VIEW];
  return merged === undefined ? undefined : mergeTable(merged);
}

function mergeTable(view: MergeView): Map<PropertyKey, any> | undefined {
  let table = view.table;
  if (table === undefined) {
    const f = view.sources,
      k = view.kinds;
    for (let i = 0; i < f.length; i++) {
      if (!entryHasStaticKeys(f[i], k[i])) {
        view.table = null;
        return undefined;
      }
    }
    table = new Map();
    for (let i = 0; i < f.length; i++) {
      const leaf = f[i];
      if (k[i] === SOURCE_OMIT) {
        const src = leaf.source;
        const keys = Reflect.ownKeys(src);
        for (let j = 0; j < keys.length; j++) {
          const key = keys[j];
          if (!isHidden(leaf, key)) tableSet(table, key, src);
          // A key this leaf hides that an EARLIER leaf owned must stay: the
          // filter applies to this leaf's contribution, not to the merge.
        }
      } else {
        const keys = Reflect.ownKeys(leaf);
        for (let j = 0; j < keys.length; j++) tableSet(table, keys[j], leaf);
      }
    }
    view.table = table;
  }
  return table === null ? undefined : table;
}

// Key order is the merged one — every key at the position of the LAST source
// that carries it — the order `ssrElement`'s array form serializes in and the
// eager copy enumerated in, so a spread through a view and a spread over the
// sources emit the same attribute order.
function tableSet(table: Map<PropertyKey, any>, key: PropertyKey, leaf: any) {
  if (table.has(key)) table.delete(key);
  table.set(key, leaf);
}

// An omit view's table: its source's (a merge's table, or a plain object's
// own keys) minus the hidden keys. Cached on the record.
function omitTable(view: OmitView): Map<PropertyKey, any> | undefined {
  let table = view.table;
  if (table === undefined) {
    const src = view.source;
    let base: Map<PropertyKey, any> | undefined;
    if (view.kind === SOURCE_MEMO) base = undefined;
    else if (view.kind === SOURCE_PROXY) base = resolvedTable(src);
    else {
      base = new Map();
      const keys = Reflect.ownKeys(src);
      for (let j = 0; j < keys.length; j++) base.set(keys[j], src);
    }
    if (base === undefined) {
      view.table = null;
      return undefined;
    }
    table = new Map();
    for (const [key, leaf] of base) if (!isHidden(view, key)) table.set(key, leaf);
    view.table = table;
  }
  return table === null ? undefined : table;
}

// The user-facing key set of a resolved table: its keys that are enumerable
// on the leaf that owns them (`Object.keys(merged)`, #2769). Fixed, like the
// table, so it is built once per view: an `ownKeys` trap may hand back the
// same array every time (the engine copies it).
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
function tableOwnKeys(view: MergeView | OmitView, table: Map<PropertyKey, any>) {
  let keys = view.keys;
  if (keys === undefined) {
    keys = view.keys = [];
    for (const [key, leaf] of table)
      if (propertyIsEnumerable.call(leaf, key)) keys.push(key as string | symbol);
  }
  return keys;
}

// The descriptor for a table key — its owning leaf's, truthful (see
// `sourceDescriptor`) — with the shape cached per key so an enumeration
// (`for…in`, `Object.keys`, `{...props}`: a descriptor trap per key, on
// every pass) does not re-read the leaf's descriptor and re-allocate a
// getter each time. An accessor reads live, so its descriptor is reused as
// is; a data descriptor is rebuilt with the current value.
function tableDescriptor(
  view: MergeView | OmitView,
  table: Map<PropertyKey, any>,
  key: PropertyKey
): PropertyDescriptor | undefined {
  const leaf = table.get(key);
  if (leaf === undefined) return undefined;
  let descs = view.descs;
  if (descs === undefined) descs = view.descs = new Map();
  let cached = descs.get(key);
  if (cached === undefined) {
    cached = sourceDescriptor(leaf, SOURCE_PLAIN, key);
    if (cached === undefined) return undefined;
    descs.set(key, cached);
    return cached;
  }
  if (cached.get !== undefined) return cached;
  return {
    configurable: true,
    enumerable: cached.enumerable,
    writable: cached.writable,
    value: leaf[key]
  };
}

function mergeGet(view: MergeView, property: PropertyKey): any {
  const table = mergeTable(view);
  if (table !== undefined) {
    const leaf = table.get(property);
    return leaf === undefined ? undefined : leaf[property];
  }
  const f = view.sources,
    k = view.kinds;
  for (let i = f.length - 1; i >= 0; i--) {
    const kind = k[i];
    if (kind === SOURCE_OMIT) {
      const v: OmitView = f[i];
      if (isHidden(v, property)) continue;
      const s = viewSource(v);
      if (property in s) return s[property];
    } else {
      const s = leafOf(f[i], kind);
      if (property in s) return s[property];
    }
  }
}

const mergeTraps: ProxyHandler<MergeView> = {
  get(view, property, receiver) {
    if (property === $PROXY) return receiver;
    if (property === $TARGET || property === $OMIT) return undefined;
    if (property === $SOURCES) return view.sources;
    if (property === $VIEW) return view;
    return mergeGet(view, property);
  },
  has(view, property) {
    if (property === $PROXY) return true;
    if (property === $TARGET || property === $OMIT || property === $SOURCES || property === $VIEW)
      return false;
    const table = mergeTable(view);
    if (table !== undefined) return table.has(property);
    const f = view.sources,
      k = view.kinds;
    for (let i = f.length - 1; i >= 0; i--) if (sourceHas(f[i], k[i], property)) return true;
    return false;
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(view, property) {
    if (
      property === $PROXY ||
      property === $TARGET ||
      property === $OMIT ||
      property === $SOURCES ||
      property === $VIEW
    )
      return undefined;
    const table = mergeTable(view);
    if (table !== undefined) return tableDescriptor(view, table, property);
    const f = view.sources,
      k = view.kinds;
    for (let i = f.length - 1; i >= 0; i--) {
      if (!sourceHas(f[i], k[i], property)) continue;
      // `in` also answers for inherited keys, which have no own descriptor.
      return (
        sourceDescriptor(f[i], k[i], property, true) ??
        accessorDescriptor(() => mergeGet(view, property))
      );
    }
    return undefined;
  },
  ownKeys(view) {
    const table = mergeTable(view);
    if (table !== undefined) return tableOwnKeys(view, table);
    // Same order as the table's: a key at the position of its last source.
    const keys = new Set<string | symbol>();
    const f = view.sources,
      k = view.kinds;
    for (let i = 0; i < f.length; i++) {
      const sourceKeys = sourceEnumerableKeys(f[i], k[i]);
      for (let j = 0; j < sourceKeys.length; j++) {
        const key = sourceKeys[j];
        if (keys.has(key)) keys.delete(key);
        keys.add(key);
      }
    }
    return [...keys];
  }
};

// Over a plain object an omit view reads its source directly — a hidden-key
// check and one property read, nothing to cache. Over a MERGE it answers from
// its resolved table when the merge has one (plain leaves only), so a read
// is one lookup rather than a hop through the merge proxy's traps; the table
// is the merge's, filtered, built once per view.
const omitTraps: ProxyHandler<OmitView> = {
  get(view, property, receiver) {
    if (property === $PROXY) return receiver;
    // $VIEW is the underlying merge's record, UNFILTERED: never forwarded.
    if (property === $TARGET || property === $VIEW) return undefined;
    if (property === $OMIT) return view;
    // $SOURCES answers the FILTERED leaf entries (or nothing for a plain
    // source) — never the underlying merge's own sources, which would hand a
    // re-merge the unfiltered objects and leak the omitted keys (#3014).
    if (property === $SOURCES) return view.entries;
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) {
        const leaf = table.get(property);
        return leaf === undefined ? undefined : leaf[property];
      }
    }
    if (isHidden(view, property)) return undefined;
    return viewSource(view)[property];
  },
  has(view, property) {
    if (property === $PROXY) return true;
    if (property === $TARGET || property === $VIEW || property === $SOURCES || property === $OMIT)
      return false;
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) return table.has(property);
    }
    if (isHidden(view, property)) return false;
    return property in viewSource(view);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(view, property) {
    if (
      property === $PROXY ||
      property === $TARGET ||
      property === $VIEW ||
      property === $OMIT ||
      property === $SOURCES
    )
      return undefined;
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) return tableDescriptor(view, table, property);
    }
    return sourceDescriptor(view, SOURCE_OMIT, property);
  },
  ownKeys(view) {
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) return tableOwnKeys(view, table);
    }
    const keys = Reflect.ownKeys(viewSource(view));
    const out: (string | symbol)[] = [];
    for (let i = 0; i < keys.length; i++) if (!isHidden(view, keys[i])) out.push(keys[i]);
    return out;
  }
};
/** @internal The flattened sources behind a `merge()` proxy, or undefined.
 * A merge's writes are no-ops, so its sources are the whole truth. A COPY of
 * a merge (`{...merged}`, a descriptor copy) is a plain object that carries
 * no sources — `ownKeys` never answers $SOURCES — so what is on the copy is
 * the truth there and every consumer reads it directly (#3384). */
export function mergeSources(o: any): any[] | undefined {
  return o != null && $PROXY in o && o[$TARGET] === undefined ? o[$SOURCES] : undefined;
}
/**
 * Merges multiple props-like objects into a single proxy that *preserves
 * reactivity*. Reads are forwarded to the right-most source that defines the
 * property, so later sources override earlier ones (like `Object.assign`).
 *
 * Function arguments are treated as memo-backed sources — useful for passing
 * derived defaults whose computation should track reactively.
 *
 * The result is a live VIEW of its sources, never a copy: creating it costs
 * nothing per key, every read goes to the source that owns the key (a getter
 * runs there, a data property is read live), and writing to it is a no-op.
 * A single non-function source is returned as is. To own a mutable object,
 * copy it: `{ ...merged }` snapshots the current values.
 *
 * Use this in component bodies to merge defaults / overrides without losing
 * Solid's per-property tracking.
 *
 * @example
 * ```tsx
 * function Button(_props: { label: string; type?: string; disabled?: boolean }) {
 *   const props = merge({ type: "button", disabled: false }, _props);
 *
 *   return <button type={props.type} disabled={props.disabled}>{props.label}</button>;
 * }
 * ```
 */
export function merge<T extends unknown[]>(...sources: T): Merge<T> {
  if (sources.length === 1 && typeof sources[0] !== "function") return sources[0] as any;
  const flattened: T[] = [];
  const kinds: SourceKind[] = [];
  // The one non-falsy source, if there is exactly one: it IS the merge.
  let only: unknown = undefined;
  let count = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (!s) continue;
    count++;
    only = s;
    if (typeof s === "function") {
      flattened.push(createMemo(s as () => any) as any);
      kinds.push(SOURCE_MEMO);
      continue;
    }
    if ($PROXY in (s as object)) {
      // A store (`$TARGET`) is a leaf as it is. A merge() proxy is flattened
      // through: its writes are no-ops, so its sources are exactly what it
      // reads. An omit() proxy over a merge answers $SOURCES with its
      // FILTERED leaf views, never the merge's own sources (#3014); an
      // omit() of a plain object joins as its view record. Either way the
      // filter travels with the entry and the hidden keys stay hidden.
      if ((s as any)[$TARGET] === undefined) {
        const child: MergeView | undefined = (s as any)[$VIEW];
        if (child !== undefined) {
          for (let j = 0; j < child.sources.length; j++) {
            flattened.push(child.sources[j]);
            kinds.push(child.kinds[j]);
          }
          continue;
        }
        const view: OmitView | undefined = (s as any)[$OMIT];
        if (view !== undefined) {
          const entries = view.entries;
          if (entries !== undefined) {
            for (let j = 0; j < entries.length; j++) {
              flattened.push(entries[j] as any);
              kinds.push(SOURCE_OMIT);
            }
          } else {
            flattened.push(view as any);
            kinds.push(SOURCE_OMIT);
          }
          continue;
        }
      }
      flattened.push(s as any);
      kinds.push(SOURCE_PROXY);
      continue;
    }
    flattened.push(s as any);
    kinds.push(SOURCE_PLAIN);
  }
  if (SUPPORTS_PROXY) {
    if (count === 1 && typeof only !== "function") return only as any;
    // Always a view, never a copy. Building a plain object here costs a
    // descriptor read, a bound getter and a defineProperty per key per
    // layer, and component libraries stack several layers per element
    // (defaults → omit → call-site statics → …), so the copies dominated
    // their render cost while every consumer that matters — `spread`,
    // `ssrElement`, a nested merge — reads the flattened sources directly
    // anyway (#3448). The view is O(1) to create and reads through to the
    // sources, so a data property on a source is read live, like a getter.
    // Writes to the result are no-ops (a consumer that needs its own object
    // copies: `{...merged}`, which the traps answer truthfully). Copies of
    // the result never carry $SOURCES (#3384): `ownKeys` answers only the
    // sources' keys.
    return new Proxy(new MergeView(flattened, kinds), mergeTraps) as unknown as Merge<T>;
  }

  // No Proxy: an eager descriptor copy, semantics as close to the view as a
  // plain object allows (getters stay live; data properties are snapshots).
  const defined: Record<string, PropertyDescriptor> = Object.create(null);
  let nonTargetKey = false;
  let lastIndex = flattened.length - 1;
  for (let i = lastIndex; i >= 0; i--) {
    const source = flattened[i] as Record<string, any>;
    if (!source) {
      i === lastIndex && lastIndex--;
      continue;
    }
    const sourceKeys = Object.getOwnPropertyNames(source);
    for (let j = sourceKeys.length - 1; j >= 0; j--) {
      const key = sourceKeys[j];
      if (key === "__proto__" || key === "constructor") continue;
      if (!defined[key]) {
        nonTargetKey = nonTargetKey || i !== lastIndex;
        const desc = Object.getOwnPropertyDescriptor(source, key)!;
        defined[key] = desc.get
          ? {
              enumerable: true,
              configurable: true,
              get: desc.get.bind(source)
            }
          : desc;
      }
    }
  }
  if (!nonTargetKey) return flattened[lastIndex] as any;
  const target: Record<string, any> = {};
  const definedKeys = Object.keys(defined);
  for (let i = definedKeys.length - 1; i >= 0; i--) {
    const key = definedKeys[i],
      desc = defined[key];
    if (desc.get) Object.defineProperty(target, key, desc);
    else target[key] = desc.value;
  }
  return target as any;
}

export type Omit<T, K extends readonly (keyof T)[]> = {
  [P in keyof T as Exclude<P, K[number]>]: T[P];
};

/**
 * Returns a reactive proxy of `props` with the listed keys hidden. Tracking
 * on the remaining keys is preserved.
 *
 * Use it to forward "rest" props to a child element while pulling out the
 * keys your component handles itself — the equivalent of `splitProps(p, ["a","b"])[1]`.
 *
 * The result is a live VIEW of `props`, not a copy: nothing is read or
 * materialized until a key is used, and a spread (`{...rest}`) or a later
 * `merge()` walks the underlying object directly. A predicate hides keys by
 * rule instead of by name — `omit(props, k => k[0] === "$")` — without
 * enumerating first.
 *
 * @example
 * ```tsx
 * function Input(props: { label: string; value: string; onInput: (v: string) => void } & JSX.HTMLAttributes<HTMLInputElement>) {
 *   const rest = omit(props, "label", "value", "onInput");
 *
 *   return (
 *     <label>
 *       {props.label}
 *       <input
 *         {...rest}
 *         value={props.value}
 *         onInput={e => props.onInput(e.currentTarget.value)}
 *       />
 *     </label>
 *   );
 * }
 * ```
 */
export function omit<T extends Record<any, any>, K extends readonly (keyof T)[]>(
  props: T,
  ...keys: K
): Omit<T, K>;
export function omit<T extends Record<any, any>>(
  props: T,
  hidden: (key: keyof T & (string | symbol)) => boolean
): Partial<T>;
export function omit(props: any, ...keys: any[]): any {
  let hidden: Hidden = keys.length === 1 && typeof keys[0] === "function" ? keys[0] : keys;
  if (SUPPORTS_PROXY) {
    // A view over a view flattens: one record, both filters, the original
    // source — so a consumer walks the real object however deep the omits go.
    let source = props;
    let kind: SourceKind = SOURCE_PLAIN;
    let entries: OmitView[] | undefined;
    if (typeof props === "function") kind = SOURCE_MEMO;
    else if ($PROXY in props) {
      kind = SOURCE_PROXY;
      if (props[$TARGET] === undefined) {
        const inner: OmitView | undefined = props[$OMIT];
        if (inner !== undefined) {
          source = inner.source;
          kind = inner.kind;
          hidden = combineHidden(inner.hidden, hidden);
        }
        // Over a merge() proxy: one leaf view per flattened source (see
        // OmitView). A flattened source that is itself a view — an earlier
        // omit() this merge was built over — folds into one record with both
        // filters, so a component chain of omit/merge/omit/merge stays one
        // level deep.
        const merged: MergeView | undefined = kind === SOURCE_PROXY ? source[$VIEW] : undefined;
        if (merged !== undefined) {
          const f = merged.sources,
            k = merged.kinds;
          entries = new Array(f.length);
          for (let i = 0; i < f.length; i++) {
            const leaf = f[i];
            entries[i] =
              k[i] === SOURCE_OMIT
                ? new OmitView(leaf.source, leaf.kind, combineHidden(leaf.hidden, hidden))
                : new OmitView(leaf, k[i], hidden);
          }
        }
      }
    }
    return new Proxy(new OmitView(source, kind, hidden, entries), omitTraps);
  }
  const result: Record<string, any> = {};
  const propNames = Object.getOwnPropertyNames(props);
  const isHiddenKey: (key: string) => boolean =
    typeof hidden === "function"
      ? hidden
      : hidden.length > 4 && propNames.length > hidden.length
        ? (
            blocked => (key: string) =>
              blocked.has(key)
          )(new Set(hidden))
        : key => hidden.includes(key);

  for (const propName of propNames) {
    if (!isHiddenKey(propName)) {
      const desc = Object.getOwnPropertyDescriptor(props, propName)!;
      !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable
        ? (result[propName] = desc.value)
        : Object.defineProperty(result, propName, desc);
    }
  }
  return result as any;
}
