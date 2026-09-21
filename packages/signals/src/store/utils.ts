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
export const SOURCE_MERGE = 4; // a `MergeView` record (only as an omit's source)
export type SourceKind = 0 | 1 | 2 | 3 | 4;

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
 * An omit over a `merge()` holds the merge's RECORD (`MergeView`, kind
 * `SOURCE_MERGE`) — never its proxy, so no read hops through a trap — and is
 * one record however many leaves the merge has. A consumer walks it as ONE
 * filtered entry (`sourceKeys` / `sourceGet` recurse into the merge's
 * sources by function call), and a later `merge()` over it carries the
 * record as one entry instead of copying its leaves: on a component chain of
 * defaults + omit + spread (`merge(omit(merge(omit(props))))`) the layers
 * nest as records, each a few fields, where a flatten to leaf views built a
 * view and a combined key list per leaf per layer — the largest allocation
 * of a Kobalte-shaped render. A merge leaf may be merge's memo for a
 * function source; it is resolved on access. */
export class OmitView {
  /** see `MergeView.table` */
  table: Map<PropertyKey, any> | null | number = 0;
  /** see `tableOwnKeys` / `tableDescriptor` */
  keys: (string | symbol)[] | undefined = undefined;
  descs: Map<PropertyKey, PropertyDescriptor> | undefined = undefined;
  constructor(
    public source: any,
    /** of `source` — PLAIN, PROXY (a store or a foreign proxy), MEMO, or
     * MERGE (a `MergeView` record); never OMIT, a view over a view folds
     * into one. */
    public kind: SourceKind,
    public hidden: Hidden
  ) {}
}

type Hidden = PropertyKey[] | ((key: PropertyKey) => boolean);

function isHidden(view: OmitView, key: PropertyKey): boolean {
  const h = view.hidden;
  return typeof h === "function" ? h(key) : h.includes(key);
}

// Both filters as one. Two key lists stay a key list (one `includes`, no
// closure); a predicate on either side needs a closure. An omit over a
// merge builds one combined list per leaf, per component layer, so the
// copy's form matters in every tier: `concat` runs the species/spreadable
// protocol (2–3× the cost of a copy once optimized), a hand loop is 2–4×
// `concat` in the interpreter and baseline tiers (a bytecode per element
// against one builtin), and a presized `new Array(n)` is holey, which takes
// `includes` off its fast path. `slice` + `push` of the (short) second list
// is within a third of the best form in every tier, and packed.
function combineHidden(a: Hidden, b: Hidden): Hidden {
  if (typeof a !== "function" && typeof b !== "function") {
    const out = a.slice();
    for (let i = 0; i < b.length; i++) out.push(b[i]);
    return out;
  }
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
    if (s.kind === SOURCE_MERGE) return mergeKeysOf(s.source, false, s);
    const keys = leafKeys(viewSource(s), s.kind);
    const out: (string | symbol)[] = [];
    for (let i = 0; i < keys.length; i++) if (!isHidden(s, keys[i])) out.push(keys[i]);
    return out;
  }
  return leafKeys(leafOf(s, kind), kind);
}

/** @internal `key in entry`. */
export function sourceHas(s: any, kind: SourceKind, key: PropertyKey): boolean {
  if (kind === SOURCE_OMIT) {
    if (isHidden(s, key)) return false;
    return s.kind === SOURCE_MERGE ? mergeHas(s.source, key) : key in viewSource(s);
  }
  return key in leafOf(s, kind);
}

/** @internal `entry[key]` — the source's getter runs once, here. */
export function sourceGet(s: any, kind: SourceKind, key: PropertyKey): any {
  if (kind === SOURCE_OMIT) {
    if (isHidden(s, key)) return undefined;
    return s.kind === SOURCE_MERGE ? mergeGet(s.source, key) : viewSource(s)[key];
  }
  return leafOf(s, kind)[key];
}

// An entry whose own key set is fixed: a plain object, or a view over one —
// an omit of a plain object, or of a merge whose entries all are. Not a
// store (its key set is a tracked signal), not a merge memo source (it
// swaps whole objects), and not any proxy that declares itself with
// `$PROXY in s` — a frames slot proxy answers `has` for every key and lists
// none, so only the `in` walk is right for it.
function entryHasStaticKeys(s: any, kind: SourceKind): boolean {
  if (kind === SOURCE_PLAIN) return true;
  if (kind !== SOURCE_OMIT) return false;
  if (s.kind === SOURCE_PLAIN) return true;
  return s.kind === SOURCE_MERGE && mergeHasStaticKeys(s.source);
}

function mergeHasStaticKeys(view: MergeView): boolean {
  const f = view.sources,
    k = view.kinds;
  for (let i = 0; i < f.length; i++) if (!entryHasStaticKeys(f[i], k[i])) return false;
  return true;
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
  if (merged !== undefined) return mergeHasStaticKeys(merged);
  const view: OmitView | undefined = o[$OMIT];
  return view !== undefined && entryHasStaticKeys(view, SOURCE_OMIT);
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
 * runtime — identically on server and client, the compiler emitting the same
 * own DESCRIPTORS on both (the object behind them may differ: the server
 * builds props as a plain-prototype instance with shared getters) — and can
 * take a no-computation path for the literal:
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
  // An omit's merge record: the descriptor of the last entry that has the
  // key, as the merge proxy's own trap answers (see `mergeDescriptor`).
  if (kind === SOURCE_MERGE) return mergeDescriptor(s, key);
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
    if (s.kind === SOURCE_MERGE) return mergeEnumerableKeys(s.source, s);
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
  /** key → the plain leaf that owns it (later sources win), built by an
   * enumeration or once the reads have paid for it (see `resolvedTable`)
   * when every leaf has static keys; `null` when one doesn't. Until then
   * the slot counts the per-key trap reads so far. One slot rather than a
   * counter field of its own: a view is built per source per component
   * layer, and each field initializer is a measurable share of a
   * constructor that small in the lower JIT tiers. */
  table: Map<PropertyKey, any> | null | number = 0;
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
 * without copying: one pass over the leaves' own keys, then every
 * `get`/`has`/descriptor is one lookup plus one read of the owning leaf, and
 * a consumer (`spread` rerunning its effect) walks the table instead of
 * re-deriving shadowing from the leaves each time. Own keys only, as the
 * copy's were: a plain source's key set is fixed once merged (keys added to
 * it later are not seen — the copy didn't see them either).
 *
 * It is built by an ENUMERATION — the `ownKeys` trap, or a consumer asking
 * for it here — or once per-key reads have paid for it (`READS_FOR_TABLE`),
 * not on the first read. A per-key read has a direct answer (a walk of the
 * sources, last to first, one `in` each) whose cost is the source count,
 * while the table's is every key of every leaf, so the walk wins until a
 * view has been read about as many times as it has keys. On the server it
 * never is: a component reads its props a few times, the element enumerates
 * them once through its own source walk, and the view is gone — building on
 * first read there cost a component chain a table per layer (profiled on
 * the Kobalte-shaped chain: a third of SSR time in the table code and its
 * garbage). On the
 * client a view read on every reactive rerun crosses the threshold in its
 * first few updates and is one lookup per read from then on, as before.
 * Once built — by a `spread`, `Object.keys`, `{...props}`, or the count —
 * every trap uses it. */
export function resolvedTable(o: any): Map<PropertyKey, any> | undefined {
  if (o == null || !($PROXY in o) || o[$TARGET] !== undefined) return undefined;
  const view = o[$OMIT];
  if (view !== undefined) return omitTable(view);
  const merged = o[$VIEW];
  return merged === undefined ? undefined : mergeTable(merged);
}

function mergeTable(view: MergeView): Map<PropertyKey, any> | undefined {
  let table = view.table;
  if (typeof table !== "object") {
    // a read count: not decided yet
    const f = view.sources,
      k = view.kinds;
    for (let i = 0; i < f.length; i++) {
      if (!entryHasStaticKeys(f[i], k[i])) {
        view.table = null;
        return undefined;
      }
    }
    table = new Map();
    collectTable(table, view, undefined);
    view.table = table;
  }
  return table === null ? undefined : table;
}

// One pass over a merge record's leaves into `table`, through the nested
// omit-over-merge entries — the filters enclosing the current leaf are the
// `filters` stack — so a component chain builds ONE table at the view that
// asked, not one per layer. A key an entry hides that an EARLIER entry owned
// must stay: a filter applies to its own entry's contribution, not to the
// merge, which is exactly what the stack expresses. Every entry has static
// keys (the caller checked), so a leaf's own keys are the truth.
function collectTable(
  table: Map<PropertyKey, any>,
  view: MergeView,
  filters: OmitView[] | undefined
) {
  const f = view.sources,
    k = view.kinds;
  for (let i = 0; i < f.length; i++) {
    const leaf = f[i];
    if (k[i] === SOURCE_OMIT) {
      if (leaf.kind === SOURCE_MERGE) {
        if (filters === undefined) filters = [leaf];
        else filters.push(leaf);
        collectTable(table, leaf.source, filters);
        filters.pop();
        continue;
      }
      const src = leaf.source;
      const keys = Reflect.ownKeys(src);
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        if (!isHidden(leaf, key) && !hiddenByAny(filters, key)) tableSet(table, key, src);
      }
    } else {
      const keys = Reflect.ownKeys(leaf);
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        if (!hiddenByAny(filters, key)) tableSet(table, key, leaf);
      }
    }
  }
}

function hiddenByAny(filters: OmitView[] | undefined, key: PropertyKey): boolean {
  if (filters !== undefined)
    for (let i = filters.length - 1; i >= 0; i--) if (isHidden(filters[i], key)) return true;
  return false;
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
  if (typeof table !== "object") {
    const src = view.source;
    if (view.kind === SOURCE_MERGE) {
      // One pass over the merge's leaves with this filter on the stack —
      // the merge record builds no table of its own for it.
      if (!mergeHasStaticKeys(src)) {
        view.table = null;
        return undefined;
      }
      table = new Map();
      collectTable(table, src, [view]);
    } else if (view.kind === SOURCE_PLAIN) {
      table = new Map();
      const keys = Reflect.ownKeys(src);
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        if (!isHidden(view, key)) table.set(key, src);
      }
    } else {
      // a store or a memo: keys can change, no table
      view.table = null;
      return undefined;
    }
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

// Per-key trap reads a view takes before building its table, from the
// break-even: a build is ~60 ns per key (an `ownKeys` share, a `has`, a
// `set`), a walk ~20 ns per source (an `in`, a hidden-list check), and a
// leaf carries about five keys — so the table has paid for itself after
// ~15 reads. Measured on the Kobalte-shaped chain: a walk is 2× a lookup at
// depth 1 and up to 10× for a first-source key at depth 7 (a walk through
// seven nested layers, a hidden-list check at each), so a view read on
// every update wants the table; a view read a handful of times (every
// server-side view) never wants it.
const READS_FOR_TABLE = 16;

// The table for a per-key trap: the one a view HAS (built by an enumeration
// or an earlier read, see `resolvedTable`), or the one this read pays for,
// or none — a walk answers. One per view type, so a trap pays no type check.
// A settled slot is an object (the Map, or `null`); a number is the count.
function mergeReadTable(view: MergeView): Map<PropertyKey, any> | undefined {
  const table = view.table;
  if (typeof table === "object") return table === null ? undefined : table;
  if (table + 1 < READS_FOR_TABLE) {
    view.table = table + 1;
    return undefined;
  }
  return mergeTable(view);
}

// Only for an omit over a merge (`kind === SOURCE_MERGE`; the caller checks,
// inline — a call is not free in every tier): an omit over one object reads
// it directly — a list check and a property read, nothing a table would
// shorten.
function omitReadTable(view: OmitView): Map<PropertyKey, any> | undefined {
  const table = view.table;
  if (typeof table === "object") return table === null ? undefined : table;
  if (table + 1 < READS_FOR_TABLE) {
    view.table = table + 1;
    return undefined;
  }
  return omitTable(view);
}

// The table a record HAS — built already by an enumeration or a trap's read
// count — or undefined. What a nested walk asks: a record reached through an
// outer view's entry counts no reads of its own (the outer view decides for
// the whole tree, and its table build then builds the inner ones), so the
// inner merges of a component chain build nothing on the server where the
// leaves are read a few times each.
function tableOf(view: MergeView | OmitView): Map<PropertyKey, any> | undefined {
  const table = view.table;
  return typeof table === "object" && table !== null ? table : undefined;
}

// "no entry has the key" — distinct from an entry that holds `undefined`.
const MISSING = Symbol();

// The read: the value of the last entry that has the key, or MISSING. ONE
// walk — a nested omit-over-merge entry answers presence and value together,
// so a chain of layers is walked once per read, not once per layer per
// level.
function mergeLookup(view: MergeView, property: PropertyKey): any {
  const table = tableOf(view);
  if (table !== undefined) {
    const leaf = table.get(property);
    return leaf === undefined ? MISSING : leaf[property];
  }
  const f = view.sources,
    k = view.kinds;
  for (let i = f.length - 1; i >= 0; i--) {
    const kind = k[i];
    // The common leaf first, read in place: a component's props view is a
    // few plain objects, read once per key on the server.
    if (kind === SOURCE_PLAIN) {
      const s = f[i];
      if (property in s) return s[property];
      continue;
    }
    if (kind === SOURCE_OMIT) {
      const v: OmitView = f[i];
      if (isHidden(v, property)) continue;
      if (v.kind === SOURCE_MERGE) {
        const value = mergeLookup(v.source, property);
        if (value !== MISSING) return value;
        continue;
      }
      const s = viewSource(v);
      if (property in s) return s[property];
    } else {
      const s = leafOf(f[i], kind);
      if (property in s) return s[property];
    }
  }
  return MISSING;
}

function mergeGet(view: MergeView, property: PropertyKey): any {
  const value = mergeLookup(view, property);
  return value === MISSING ? undefined : value;
}

// `key in merge`, on the record.
function mergeHas(view: MergeView, property: PropertyKey): boolean {
  const table = tableOf(view);
  if (table !== undefined) return table.has(property);
  const f = view.sources,
    k = view.kinds;
  for (let i = f.length - 1; i >= 0; i--) if (sourceHas(f[i], k[i], property)) return true;
  return false;
}

// The proxy's `getOwnPropertyDescriptor`, on the record.
function mergeDescriptor(view: MergeView, property: PropertyKey): PropertyDescriptor | undefined {
  const table = tableOf(view);
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
}

// Own keys of a merge record in merged order — every key at the position
// of the LAST entry that carries it, the order the table keeps and
// `ssrElement` serializes in. `enumerable` selects the user-facing set
// (`Object.keys`, #2769) over every own string key (a consumer's walk);
// `filter` is the omit this record is read through, applied as the keys
// are gathered so an omit over a merge builds ONE list per layer. A list
// with `indexOf` rather than a Set: a props object has a dozen keys, and a
// Set's hash store was 2 KB per row on the Kobalte-shaped chain.
function mergeKeysOf(
  view: MergeView,
  enumerable: boolean,
  filter: OmitView | undefined
): (string | symbol)[] {
  const out: (string | symbol)[] = [];
  collectKeys(view, filter === undefined ? undefined : [filter], enumerable, out, null);
  return out;
}

// One pass over a merge record's leaves — through its nested omit-over-merge
// entries, `filters` the omits enclosing the current leaf (see
// `collectTable`) — appending each leaf's keys to `keys` in merged order
// (a key already listed moves to the end: later wins) and, when `owners` is
// given, the object that owns the key at the same index. A consumer that
// reads every key once (`ssrElement`) then reads `owners[i][keys[i]]`: no
// `in` walk per key, no table. A memo leaf is resolved once here.
function collectKeys(
  view: MergeView,
  filters: OmitView[] | undefined,
  enumerable: boolean,
  keys: (string | symbol)[],
  owners: any[] | null
) {
  const f = view.sources,
    k = view.kinds;
  for (let i = 0; i < f.length; i++) {
    let leaf = f[i],
      kind = k[i];
    let filter: OmitView | undefined;
    if (kind === SOURCE_OMIT) {
      if (leaf.kind === SOURCE_MERGE) {
        if (filters === undefined) filters = [leaf];
        else filters.push(leaf);
        collectKeys(leaf.source, filters, enumerable, keys, owners);
        filters.pop();
        continue;
      }
      filter = leaf;
      kind = leaf.kind;
      leaf = leaf.source;
    }
    leaf = leafOf(leaf, kind);
    const ks = enumerable ? ownEnumerableKeys(leaf) : leafKeys(leaf, kind);
    for (let j = 0; j < ks.length; j++) {
      const key = ks[j];
      if (filter !== undefined && isHidden(filter, key)) continue;
      if (hiddenByAny(filters, key)) continue;
      addKey(keys, owners, key, leaf);
    }
  }
}

// Append `key` owned by `owner`, moving an earlier listing to the end: later
// wins, and the position is the last owner's (the merged order).
function addKey(keys: (string | symbol)[], owners: any[] | null, key: string | symbol, owner: any) {
  const at = keys.indexOf(key);
  if (at !== -1) {
    keys.splice(at, 1);
    if (owners !== null) owners.splice(at, 1);
  }
  keys.push(key);
  if (owners !== null) owners.push(owner);
}

/** @internal Every own string key of a props SOURCE — a plain object, a
 * store or foreign proxy, or a merge/omit view — appended to `keys` in
 * merged order with the object that owns each at the same index of
 * `owners`: a key already listed (by this source or an earlier one) moves
 * to the end, so several sources collected in turn give the order and the
 * winners a merge of them would. A consumer that reads each key once
 * (`ssrElement`) then reads `owners[i][keys[i]]` — the owner's getter runs
 * there, once — and asks nothing else of a view: no table, no `in` walk per
 * key through the merge/omit layers, no key list per leaf. One pass,
 * however deep the layers nest. Symbols are listed; the consumer skips
 * them. */
export function sourceOwners(s: any, keys: (string | symbol)[], owners: any[]) {
  if ($PROXY in s) {
    const view = viewOf(s);
    if (view === undefined) {
      // a store: one `ownKeys` trap, reads through `[]`
      const ks = Reflect.ownKeys(s);
      for (let i = 0; i < ks.length; i++) addKey(keys, owners, ks[i], s);
      return;
    }
    if (view instanceof OmitView) {
      if (view.kind === SOURCE_MERGE) return collectKeys(view.source, [view], false, keys, owners);
      const leaf = viewSource(view);
      const ks = leafKeys(leaf, view.kind);
      for (let i = 0; i < ks.length; i++)
        if (!isHidden(view, ks[i])) addKey(keys, owners, ks[i], leaf);
      return;
    }
    return collectKeys(view, undefined, false, keys, owners);
  }
  const ks = Object.keys(s);
  for (let i = 0; i < ks.length; i++) addKey(keys, owners, ks[i], s);
}
// The user-facing key set of a merge record, read through `filter` if given.
function mergeEnumerableKeys(view: MergeView, filter?: OmitView): (string | symbol)[] {
  const table = mergeTable(view);
  if (table === undefined) return mergeKeysOf(view, true, filter);
  const keys = tableOwnKeys(view, table);
  if (filter === undefined) return keys;
  const out: (string | symbol)[] = [];
  for (let i = 0; i < keys.length; i++) if (!isHidden(filter, keys[i])) out.push(keys[i]);
  return out;
}

const mergeTraps: ProxyHandler<MergeView> = {
  get(view, property, receiver) {
    // The private keys are symbols; a string read (every prop) skips the four
    // compares.
    if (typeof property === "symbol") {
      if (property === $PROXY) return receiver;
      if (property === $TARGET || property === $OMIT) return undefined;
      if (property === $SOURCES) return view.sources;
      if (property === $VIEW) return view;
    }
    // A trap read counts toward the table (see `mergeReadTable`); the walk
    // itself is the record's. `mergeReadTable` and the plain walk of
    // `mergeLookup` are inlined here: a trap is entered from the runtime, so
    // nothing below it is inlined for it, and a component's props view is a
    // few plain objects read once per key on the server — the walk is the
    // whole read. A leaf that is not plain hands the walk to `mergeGet`,
    // which starts over (a plain leaf walked twice is two `in` checks).
    const state = view.table;
    let table: Map<PropertyKey, any> | undefined;
    if (typeof state !== "object") {
      if (state + 1 < READS_FOR_TABLE) {
        view.table = state + 1;
        const f = view.sources,
          k = view.kinds;
        for (let i = f.length - 1; i >= 0; i--) {
          if (k[i] !== SOURCE_PLAIN) return mergeGet(view, property);
          // Read first, `in` only to tell a missing key from one holding
          // undefined: the last source is the one that usually has the key.
          const v = f[i][property];
          if (v !== undefined || property in f[i]) return v;
        }
        return undefined;
      }
      table = mergeTable(view);
      if (table === undefined) return mergeGet(view, property);
    } else if (state === null) return mergeGet(view, property);
    else table = state;
    const leaf = table.get(property);
    return leaf === undefined ? undefined : leaf[property];
  },
  has(view, property) {
    if (property === $PROXY) return true;
    if (property === $TARGET || property === $OMIT || property === $SOURCES || property === $VIEW)
      return false;
    const table = mergeReadTable(view);
    if (table !== undefined) return table.has(property);
    return mergeHas(view, property);
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
    const table = mergeReadTable(view);
    if (table !== undefined) return tableDescriptor(view, table, property);
    return mergeDescriptor(view, property);
  },
  ownKeys(view) {
    return mergeEnumerableKeys(view);
  }
};

// An omit view reads its source directly — a hidden-key check and one
// property read; over a merge record, the merge's own walk by function call,
// never a trap. Once an enumeration or the read count has built its table
// (over a merge with plain leaves only: the merge's, filtered) every trap
// answers from that instead.
const omitTraps: ProxyHandler<OmitView> = {
  get(view, property, receiver) {
    if (property === $PROXY) return receiver;
    // $VIEW is the underlying merge's record, UNFILTERED: never forwarded,
    // and $SOURCES never answers the merge's own sources, which would hand
    // a re-merge the unfiltered objects and leak the omitted keys (#3014).
    // A consumer reaches the record through $OMIT and walks it as ONE
    // filtered entry.
    if (property === $TARGET || property === $VIEW || property === $SOURCES) return undefined;
    if (property === $OMIT) return view;
    if (view.kind === SOURCE_MERGE) {
      const table = omitReadTable(view);
      if (table !== undefined) {
        const leaf = table.get(property);
        return leaf === undefined ? undefined : leaf[property];
      }
      if (isHidden(view, property)) return undefined;
      return mergeGet(view.source, property);
    }
    if (isHidden(view, property)) return undefined;
    return viewSource(view)[property];
  },
  has(view, property) {
    if (property === $PROXY) return true;
    if (property === $TARGET || property === $VIEW || property === $SOURCES || property === $OMIT)
      return false;
    if (view.kind === SOURCE_MERGE) {
      const table = omitReadTable(view);
      if (table !== undefined) return table.has(property);
      if (isHidden(view, property)) return false;
      return mergeHas(view.source, property);
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
    if (view.kind === SOURCE_MERGE) {
      const table = omitReadTable(view);
      if (table !== undefined) return tableDescriptor(view, table, property);
    }
    return sourceDescriptor(view, SOURCE_OMIT, property);
  },
  ownKeys(view) {
    if (view.kind === SOURCE_MERGE) {
      const table = omitTable(view);
      if (table !== undefined) return tableOwnKeys(view, table);
      // No table (a store or memo leaf): the merge's own key set, filtered.
      return sourceEnumerableKeys(view, SOURCE_OMIT);
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
 * Reading props, here and anywhere: a prop's getter is defined only for a
 * read through its own object (`props.x`, `{ ...props }`, `Reflect.get`,
 * these views). Forwarding its descriptor onto another object and reading it
 * there is not supported — the compiler's server-side props keep their state
 * on the instance, so the getter needs its object as receiver. A copy that
 * must stay live defines its own getter that reads through the source, as
 * the no-Proxy paths of merge() and omit() do.
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
  // Sized to the argument count up front: a view is built per source per
  // component layer, and growing two empty arrays by `push` was a third of
  // its construction. A nested view's sources may run past the count (the
  // array grows), a falsy source leaves it short (trimmed below).
  const flattened: T[] = new Array(sources.length);
  const kinds: SourceKind[] = new Array(sources.length);
  let n = 0;
  // The one non-falsy source, if there is exactly one: it IS the merge.
  let only: unknown = undefined;
  let count = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (!s) continue;
    count++;
    only = s;
    if (typeof s === "function") {
      flattened[n] = createMemo(s as () => any) as any;
      kinds[n++] = SOURCE_MEMO;
      continue;
    }
    if ($PROXY in (s as object)) {
      // A store (`$TARGET`) is a leaf as it is. A merge() proxy is flattened
      // through: its writes are no-ops, so its sources are exactly what it
      // reads. An omit() proxy joins as its view record — ONE entry, its
      // filter travelling with it, whether it is over a plain object or a
      // whole merge (never the merge's own sources, which would leak the
      // omitted keys, #3014). A consumer's walk recurses into the record.
      if ((s as any)[$TARGET] === undefined) {
        const child: MergeView | undefined = (s as any)[$VIEW];
        if (child !== undefined) {
          for (let j = 0; j < child.sources.length; j++) {
            flattened[n] = child.sources[j];
            kinds[n++] = child.kinds[j];
          }
          continue;
        }
        const view: OmitView | undefined = (s as any)[$OMIT];
        if (view !== undefined) {
          flattened[n] = view as any;
          kinds[n++] = SOURCE_OMIT;
          continue;
        }
      }
      flattened[n] = s as any;
      kinds[n++] = SOURCE_PROXY;
      continue;
    }
    flattened[n] = s as any;
    kinds[n++] = SOURCE_PLAIN;
  }
  if (n !== flattened.length) {
    flattened.length = n;
    kinds.length = n;
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
    // A view over a view folds: one record, both filters, the original
    // source — so a consumer walks the real object however deep the omits go.
    // Over a merge() proxy the source is the merge's RECORD (see OmitView):
    // one record whatever the leaf count, read by function call.
    let source = props;
    let kind: SourceKind = SOURCE_PLAIN;
    if (typeof props === "function") kind = SOURCE_MEMO;
    else if ($PROXY in props) {
      kind = SOURCE_PROXY;
      if (props[$TARGET] === undefined) {
        const inner: OmitView | undefined = props[$OMIT];
        if (inner !== undefined) {
          source = inner.source;
          kind = inner.kind;
          hidden = combineHidden(inner.hidden, hidden);
        } else {
          const merged: MergeView | undefined = props[$VIEW];
          if (merged !== undefined) {
            source = merged;
            kind = SOURCE_MERGE;
          }
        }
      }
    }
    return new Proxy(new OmitView(source, kind, hidden), omitTraps);
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
      if (!desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable) {
        result[propName] = desc.value;
      } else if (desc.get || desc.set) {
        // An accessor is re-homed with its source as receiver, never copied
        // as-is: a props getter is only defined for a read THROUGH its own
        // object (the compiler's server props keep their state on the
        // instance, so a forwarded descriptor read on the copy throws). Same
        // rule as merge()'s copy path above.
        Object.defineProperty(result, propName, {
          enumerable: desc.enumerable,
          configurable: true,
          get: desc.get && desc.get.bind(props),
          set: desc.set && desc.set.bind(props)
        });
      } else Object.defineProperty(result, propName, desc);
    }
  }
  return result as any;
}
