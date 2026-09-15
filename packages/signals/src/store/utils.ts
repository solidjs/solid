import { pendingCheckActive } from "../core/core.js";
import { SUPPORTS_PROXY } from "../core/index.js";
import { createMemo } from "../signals.js";
import { $PROXY, ownEnumerableKeys } from "./store.js";

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

function resolveSource(s: any) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}

const $SOURCES = Symbol(__DEV__ ? "MERGE_SOURCE" : 0);
const $OMIT = Symbol(__DEV__ ? "OMIT_VIEW" : 0);

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
  constructor(
    public source: any,
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

const EMPTY = Object.freeze({});
// The object a view filters, with a merge memo leaf resolved (tracked, as
// merge's own reads are) and a nullish result read as no keys.
function viewSource(view: OmitView): any {
  let s = view.source;
  if (typeof s === "function") s = s();
  return s == null ? EMPTY : s;
}

/** @internal The `OmitView` behind an `omit()` proxy, or undefined. */
export function omitView(o: any): OmitView | undefined {
  return o != null && o[$PROXY] === o ? o[$OMIT] : undefined;
}

// A props SOURCE ENTRY is a plain object, a proxy (store, merge, omit — the
// last two are normally unwrapped first: `mergeSources` / `omitView`), or an
// `OmitView` record. These three answer for an entry what `Object.keys` /
// `in` / `[]` answer for an object, so every consumer walks entries with one
// code path and an `OmitView` is filtered rather than materialized.

/** @internal Own string keys of a source entry — every consumer skips symbols
 * itself. A proxy answers through ONE `ownKeys` trap (a store's keeps the key
 * set tracked); `Object.keys` on a proxy would add a descriptor trap per key. */
export function sourceKeys(s: any): (string | symbol)[] {
  if (s instanceof OmitView) {
    const keys = sourceKeys(viewSource(s));
    const out: (string | symbol)[] = [];
    for (let i = 0; i < keys.length; i++) if (!isHidden(s, keys[i])) out.push(keys[i]);
    return out;
  }
  return s[$PROXY] === s ? Reflect.ownKeys(s) : Object.keys(s);
}

/** @internal `key in entry`. */
export function sourceHas(s: any, key: PropertyKey): boolean {
  return s instanceof OmitView ? !isHidden(s, key) && sourceHas(viewSource(s), key) : key in s;
}

/** @internal `entry[key]` — the source's getter runs once, here. */
export function sourceGet(s: any, key: PropertyKey): any {
  return s instanceof OmitView
    ? isHidden(s, key)
      ? undefined
      : sourceGet(viewSource(s), key)
    : s[key];
}

// A leaf whose own key set is fixed: a plain object. Not a store (its key
// set is a tracked signal), not a merge memo source (it swaps whole objects),
// and not any proxy that declares itself with `$PROXY in s` — a frames slot
// proxy answers `has` for every key and lists none, so only the `in` walk
// is right for it.
function leafHasStaticKeys(leaf: any): boolean {
  if (leaf instanceof OmitView) leaf = leaf.source;
  return typeof leaf !== "function" && !($PROXY in leaf);
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
  const sources = o[$SOURCES];
  if (sources !== undefined) {
    for (let i = 0; i < sources.length; i++) if (!leafHasStaticKeys(sources[i])) return false;
    return true;
  }
  const view = o[$OMIT];
  return view !== undefined && leafHasStaticKeys(view);
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
function sourceDescriptor(s: any, key: PropertyKey): PropertyDescriptor | undefined {
  if (s instanceof OmitView) {
    if (isHidden(s, key)) return undefined;
    const raw = s.source;
    if (typeof raw === "function") {
      return sourceHas(viewSource(s), key)
        ? accessorDescriptor(() => sourceGet(s, key))
        : undefined;
    }
    return sourceDescriptor(raw, key);
  }
  if (s[$PROXY] === s) {
    const desc = Reflect.getOwnPropertyDescriptor(s, key);
    if (desc === undefined) return undefined;
    // Another view (an omit's source may be a merge proxy) already answers
    // truthfully; a store's reported "data" is a signal.
    return s[$SOURCES] !== undefined || s[$OMIT] !== undefined
      ? desc
      : accessorDescriptor(() => s[key], desc.enumerable);
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
function sourceEnumerableKeys(s: any): (string | symbol)[] {
  if (s instanceof OmitView) {
    const keys = sourceEnumerableKeys(viewSource(s));
    const out: (string | symbol)[] = [];
    for (let i = 0; i < keys.length; i++) if (!isHidden(s, keys[i])) out.push(keys[i]);
    return out;
  }
  return ownEnumerableKeys(s);
}

// The target of a merge() proxy: the flattened sources, read by one shared
// handler — like OmitView, no per-instance closures. `sources` is what
// `$SOURCES` answers.
class MergeView {
  /** key → the plain leaf that owns it (later sources win), built on first
   * read when every leaf has static keys; `null` when one doesn't. */
  table: Map<PropertyKey, any> | null | undefined = undefined;
  constructor(public sources: any[]) {}
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
  if (o == null || !($PROXY in o)) return undefined;
  const view = o[$OMIT];
  if (view !== undefined) return omitTable(view);
  const sources = o[$SOURCES];
  return sources === undefined ? undefined : mergeTable(mergeViewOf(o));
}

// The MergeView behind a merge proxy. `$SOURCES` answers the array; the
// record itself is reached through this symbol so the table can live on it.
const $VIEW = Symbol(__DEV__ ? "MERGE_VIEW" : 0);
function mergeViewOf(proxy: any): MergeView {
  return proxy[$VIEW];
}

function mergeTable(view: MergeView): Map<PropertyKey, any> | undefined {
  let table = view.table;
  if (table === undefined) {
    const f = view.sources;
    for (let i = 0; i < f.length; i++) {
      if (!leafHasStaticKeys(f[i])) {
        view.table = null;
        return undefined;
      }
    }
    table = new Map();
    for (let i = 0; i < f.length; i++) {
      const leaf = f[i];
      if (leaf instanceof OmitView) {
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
    if (typeof src === "function" || src == null) base = undefined;
    else if ($PROXY in src) base = resolvedTable(src);
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
// on the leaf that owns them (`Object.keys(merged)`, #2769).
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
function tableKeys(table: Map<PropertyKey, any>): (string | symbol)[] {
  const out: (string | symbol)[] = [];
  for (const [key, leaf] of table)
    if (propertyIsEnumerable.call(leaf, key)) out.push(key as string | symbol);
  return out;
}

function mergeGet(view: MergeView, property: PropertyKey): any {
  const table = mergeTable(view);
  if (table !== undefined) {
    const leaf = table.get(property);
    return leaf === undefined ? undefined : leaf[property];
  }
  const f = view.sources;
  for (let i = f.length - 1; i >= 0; i--) {
    const s = resolveSource(f[i]);
    if (sourceHas(s, property)) return sourceGet(s, property);
  }
}

const mergeTraps: ProxyHandler<MergeView> = {
  get(view, property, receiver) {
    if (property === $PROXY) return receiver;
    if (property === $SOURCES) return view.sources;
    if (property === $VIEW) return view;
    return mergeGet(view, property);
  },
  has(view, property) {
    if (property === $PROXY) return true;
    if (property === $SOURCES || property === $VIEW) return false;
    const table = mergeTable(view);
    if (table !== undefined) return table.has(property);
    const f = view.sources;
    for (let i = f.length - 1; i >= 0; i--) {
      if (sourceHas(resolveSource(f[i]), property)) return true;
    }
    return false;
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(view, property) {
    if (property === $PROXY || property === $SOURCES || property === $VIEW) return undefined;
    const table = mergeTable(view);
    if (table !== undefined) {
      const leaf = table.get(property);
      return leaf === undefined ? undefined : sourceDescriptor(leaf, property);
    }
    const f = view.sources;
    for (let i = f.length - 1; i >= 0; i--) {
      const raw = f[i];
      const s = resolveSource(raw);
      if (!sourceHas(s, property)) continue;
      // A memo source (`merge(() => …)`) is reactive wholesale: whatever
      // shape the memo's current object has, the key is an accessor here.
      if (typeof raw === "function") return accessorDescriptor(() => mergeGet(view, property));
      // `in` also answers for inherited keys, which have no own descriptor.
      return sourceDescriptor(s, property) ?? accessorDescriptor(() => mergeGet(view, property));
    }
    return undefined;
  },
  ownKeys(view) {
    const table = mergeTable(view);
    if (table !== undefined) return tableKeys(table);
    // Same order as the table's: a key at the position of its last source.
    const keys = new Set<string | symbol>();
    const f = view.sources;
    for (let i = 0; i < f.length; i++) {
      const sourceKeys = sourceEnumerableKeys(resolveSource(f[i]));
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
    return view.source[property];
  },
  has(view, property) {
    if (property === $PROXY) return true;
    if (property === $SOURCES || property === $OMIT) return false;
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) return table.has(property);
    }
    if (isHidden(view, property)) return false;
    return property in view.source;
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(view, property) {
    if (property === $PROXY || property === $OMIT || property === $SOURCES) return undefined;
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) {
        const leaf = table.get(property);
        return leaf === undefined ? undefined : sourceDescriptor(leaf, property);
      }
    }
    return sourceDescriptor(view, property);
  },
  ownKeys(view) {
    if (view.entries !== undefined) {
      const table = omitTable(view);
      if (table !== undefined) return tableKeys(table);
    }
    const keys = Reflect.ownKeys(view.source);
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
  return o != null && o[$PROXY] === o ? o[$SOURCES] : undefined;
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
      continue;
    }
    if ($PROXY in (s as object)) {
      // A merge() proxy is flattened through: its writes are no-ops, so its
      // sources are exactly what it reads. An omit() proxy over a merge
      // answers $SOURCES with its FILTERED leaf views, never the merge's own
      // sources (#3014); an omit() of a plain object joins as its view
      // record. Either way the filter travels with the entry and the hidden
      // keys stay hidden.
      const childSources = (s as object)[$SOURCES];
      if (childSources) {
        for (let j = 0; j < childSources.length; j++) flattened.push(childSources[j]);
        continue;
      }
      const view = (s as object)[$OMIT];
      if (view) {
        flattened.push(view);
        continue;
      }
    }
    flattened.push(s as any);
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
    return new Proxy(new MergeView(flattened), mergeTraps) as unknown as Merge<T>;
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
    const inner: OmitView | undefined = props[$PROXY] === props ? props[$OMIT] : undefined;
    if (inner !== undefined) {
      source = inner.source;
      hidden = combineHidden(inner.hidden, hidden);
    }
    // Over a merge() proxy: one leaf view per flattened source (see OmitView).
    // A flattened source that is itself a view — an earlier omit() this merge
    // was built over — folds into one record with both filters, so a
    // component chain of omit/merge/omit/merge stays one level deep.
    const merged = mergeSources(source);
    let entries: OmitView[] | undefined;
    if (merged !== undefined) {
      entries = new Array(merged.length);
      for (let i = 0; i < merged.length; i++) {
        const leaf = merged[i];
        entries[i] =
          leaf instanceof OmitView
            ? new OmitView(leaf.source, combineHidden(leaf.hidden, hidden))
            : new OmitView(leaf, hidden);
      }
    }
    return new Proxy(new OmitView(source, hidden, entries), omitTraps);
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
