// @ts-nocheck
// The attribute runtime: what compiled JSX and `spread`/`assign` write onto
// an element — attributes, properties, class, style, event handlers — and the
// prop collection a spread reads them from. Its own module (not part of
// client.ts) so that an application whose only importer of `assign` is a
// lazy chunk (the frames bind tier) carries this runtime in that chunk: a
// bundler assigns modules to chunks whole, and client.ts is in every page's
// eager graph. Nothing here is read at module evaluation; every seam into
// the core module (`ref`, `delegateEvents`, `claimElement`) and the children
// runtime (`insert`, `insertExpression`) is a call at write time.
import { $PROXY } from "solid-js";
import {
  viewOf,
  OmitView,
  sourceKeys,
  sourceHas,
  sourceGet,
  hasStaticKeys,
  resolvedTable,
  SOURCE_PLAIN,
  SOURCE_OMIT,
  SOURCE_PROXY,
  SOURCE_MEMO
} from "solid-js/internal";
import { EVENT_KEY } from "../constants.js";
import { ChildProperties, Namespaces, DelegatedEvents, DOMWithState } from "../attribute-tables.js";
import { effect, setSpreadName, spreadName, tagElement, dispatchAsInteraction } from "../render.js";
import { lowercaseEventAttribute } from "../diagnostics.js";
import { claimElement, delegateEvents, ref } from "../client.js";
import { insert, insertExpression, normalize, isHydrating, setUnscopedByDesign } from "./insert.js";
import { JSX } from "../../jsx/jsx.js";

export { DOMWithState, ChildProperties, Namespaces, DelegatedEvents } from "../attribute-tables.js";

// Marks a tuple handler's listener wrapper with the authored tuple, so an
// unrelated spread rerun keeps the same attached listener (see assignProp).
const $$EVENT_TUPLE = Symbol();
const hasOwn = Object.prototype.hasOwnProperty;

/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setProperty(node: Element, name: string, value: any): void;

export function setProperty(node, name, value) {
  if ("_SOLID_DEV_") tagElement(node);
  if (isHydrating(node)) return;
  // Stateful DOM properties (DOMWithState) route through here in hydratable
  // builds so the claim pass adopts pre-hydration user state instead of
  // clobbering it (#3182). Mirror the special cases the compiler emits for
  // the direct-assignment path: <select value> defers a microtask so options
  // rendered later in the same pass are selectable, and input/textarea
  // value/defaultValue clear on nullish instead of stringifying (#2957).
  const nodeName = node.nodeName;
  if (name === "value" && nodeName === "SELECT")
    queueMicrotask(() => (node.value = value)) || (node.value = value);
  else if (
    (name === "value" || name === "defaultValue") &&
    (nodeName === "INPUT" || nodeName === "TEXTAREA")
  )
    node[name] = value ?? "";
  else node[name] = value;
}

/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setAttribute(node: Element, name: string, value: string): void;

export function setAttribute(node, name, value) {
  if ("_SOLID_DEV_") {
    tagElement(node);
    if (typeof value === "function" && name.startsWith("on")) lowercaseEventAttribute(name, node);
  }
  if (isHydrating(node)) return;
  const selectMultiple = name === "multiple" && node.localName === "select";
  if (value == null || value === false) node.removeAttribute(name);
  else {
    node.setAttribute(name, value === true ? "" : value);
    // A dynamic `multiple` reaches the select only after its options were
    // parsed under single-select rules, which keep just the last `selected`
    // option. On the first truthy write restore the parser's multi-select
    // selectedness from the options' defaults so an initially-true
    // expression matches the static attribute (#3179). Later toggles keep
    // the live selection state, exactly like toggling the attribute on
    // static markup.
    if (selectMultiple && !node._$multiple) {
      const options = node.options;
      for (let i = 0; i < options.length; i++) {
        if (options[i].defaultSelected) options[i].selected = true;
      }
    }
  }
  if (selectMultiple) node._$multiple = true;
  // Frozen contract with compiled output: `href`/`action` can only change
  // through compiler-owned write paths, which all land here — so one recheck
  // at this site keeps claim consumers fresh with no observers (claimElement
  // is the null check when no consumer is registered).
  if (name === "href" || name === "action") claimElement(node);
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function setAttributeNS(node: Element, namespace: string, name: string, value: string): void;

export function setAttributeNS(node, namespace, name, value) {
  if ("_SOLID_DEV_") tagElement(node);
  if (isHydrating(node)) return;
  // removeAttributeNS takes the local name; setAttributeNS accepts the qualified form.
  if (value == null || value === false)
    node.removeAttributeNS(namespace, name.indexOf(":") > -1 ? name.split(":").pop() : name);
  else node.setAttributeNS(namespace, name, value === true ? "" : value);
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function className(node: Element, value: JSX.ClassValue, prev?: JSX.ClassValue): void;

export function className(node, value, prev) {
  if ("_SOLID_DEV_") tagElement(node);
  // Numbers stringify like the compiler's static output (`class={1}`
  // inlines as `class="1"` in the template) so static and dynamic forms of
  // the same ClassValue behave identically (#3189).
  if (typeof value === "number") value = "" + value;
  if (typeof prev === "number") prev = "" + prev;
  if (isHydrating(node)) {
    // Seed applied state without touching the claimed DOM so later in-place
    // mutations can still be diffed after hydration completes.
    node._$classes = value && typeof value === "object" ? classListToObject(value) : undefined;
    return;
  }
  if (value == null || value === false) {
    if (prev || node._$classes) {
      node.removeAttribute("class");
      node._$classes = undefined;
    }
    return;
  }
  if (typeof value === "string") {
    node._$classes = undefined;
    value !== prev && node.setAttribute("class", value);
    return;
  }
  // Track classes applied by className() itself. value/prev are user-owned
  // and may be the same object on shared-effect reruns.
  let applied;
  if (typeof prev === "string") {
    applied = {};
    node.removeAttribute("class");
  } else applied = node._$classes || classListToObject(prev || {});
  value = classListToObject(value);
  const classKeys = Object.keys(value);
  const prevKeys = Object.keys(applied);
  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    node.classList.remove(key);
  }
  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || applied[key] === classValue || !classValue) continue;
    node.classList.add(key);
  }
  node._$classes = value;
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function addEvent(
  node: Element,
  name: string,
  handler: EventListener | EventListenerObject | (EventListenerObject & AddEventListenerOptions),
  delegate: boolean
): EventListener | EventListenerObject | void;

export function addEvent(node, name, handler, delegate) {
  if (delegate) {
    const key = EVENT_KEY + name;
    let data;
    if (Array.isArray(handler)) {
      data = handler[1];
      node[key] = handler[0];
    } else node[key] = handler;
    node[`${key}Data`] = data;
    return;
  }
  if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    const listener = "_SOLID_OBSERVE_"
      ? e => dispatchAsInteraction(e, () => handlerFn.call(node, handler[1], e))
      : e => handlerFn.call(node, handler[1], e);
    // Keep authored identity on this attachment's wrapper, never on the
    // shared element where another spread/root/direct listener could replace it.
    listener[$$EVENT_TUPLE] = handler;
    node.addEventListener(name, listener);
    return listener;
  }
  if ("_SOLID_OBSERVE_" && typeof handler === "function") {
    // Observe/dev wrap plain function listeners for provenance; the wrapper is
    // what the caller gets back, so removal by the returned identity still works.
    // Listener objects keep their identity (their options object rides along
    // on the attach call and must match on removal).
    const listener = e => dispatchAsInteraction(e, () => handler.call(node, e));
    node.addEventListener(name, listener);
    return listener;
  }
  node.addEventListener(name, handler, typeof handler !== "function" && handler);
  return handler;
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function style(
  node: Element,
  value: { [k: string]: string },
  prev?: { [k: string]: string }
): void;

export function style(node, value, prev) {
  if ("_SOLID_DEV_") tagElement(node);
  // Hydration is a claim pass: the server-rendered inline style stays
  // authoritative, consistent with class/attribute bindings (#3180). The
  // first post-hydration update diffs against the hydration-time value
  // (threaded through `prev` by the compiled effect / spread bookkeeping),
  // so properties that actually change apply and dropped ones are removed.
  if (isHydrating(node)) return;
  if (!value) {
    if (prev || node._$styles) {
      setAttribute(node, "style");
      node._$styles = undefined;
    }
    return;
  }
  const nodeStyle = node.style;
  if (typeof value === "string") {
    node._$styles = undefined;
    return (nodeStyle.cssText = value);
  }
  if (typeof prev === "string") {
    nodeStyle.cssText = "";
    prev = undefined;
  }
  // Track declarations applied by style() itself. value/prev are user-owned
  // and may be the same object on shared-effect reruns.
  let applied = node._$styles;
  if (!applied) {
    // seed from prev so direct callers that track their own previous value
    // still get removals on their first call here
    applied = node._$styles = prev ? { ...prev } : {};
  }
  let v, s;
  for (s in applied) {
    if (!hasOwn.call(value, s) || value[s] == null) {
      nodeStyle.removeProperty(s);
      delete applied[s];
    }
  }
  // Diff against applied state so in-place mutations are detected without
  // rewriting unchanged DOM styles.
  for (s in value) {
    if (!hasOwn.call(value, s)) continue;
    v = value[s];
    if (v != null && v !== applied[s]) {
      nodeStyle.setProperty(s, v);
      applied[s] = v;
    }
  }
}

/** Compiler-emitted primitive; not for hand-written code. @internal
 *
 * Read an object-valued `style` / `class` binding ONE layer deep, TRACKED, in
 * the compute half of its effect. (Not solid-js's `snapshot()`, which is a
 * deep, untracked structural copy.) `style()` and `className()` enumerate their object in the
 * effect's untracked commit phase, so a proxy-backed object (a store
 * sub-object, merged props) was identity-reactive only: in-place key
 * mutations never re-applied and every leaf read tripped
 * STRICT_READ_UNTRACKED in dev. The compiler wraps the compute value of a
 * non-inline `style={expr}` / `class={expr}` in this; spread() applies it to
 * those two keys as it copies. Inline literals never get here — they compile
 * per property. Identity passthrough for strings and plain objects (a fresh
 * literal is already the compute's own); a proxy is copied with ONE
 * `ownKeys` trap (its own trap keeps the key set tracked) plus one tracked
 * read per key; a clsx-style class array is re-mapped element-wise (className
 * allocates for an array anyway; measured at parity). */
export function readShallow(value: unknown): unknown;
export function readShallow(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(readShallow);
  if (value[$PROXY] !== value) return value;
  const keys = sourceKeys(value, SOURCE_PROXY);
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (typeof k === "string") out[k] = value[k];
  }
  return out;
}

/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setStyleProperty(node: Element, name: string, value: any): void;

export function setStyleProperty(node, name, value) {
  if ("_SOLID_DEV_") tagElement(node);
  // Same hydration adoption contract as style() (#3180): the compiled
  // per-property effect dedupes against the previous compute value, so the
  // first actual change after hydration writes through.
  if (isHydrating(node)) return;
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function spread(
  node: Element,
  sources: unknown[],
  skipChildren?: Boolean,
  skip?: (key: string) => boolean,
  name?: string
): void;
export function spread<T>(
  node: Element,
  accessor: T,
  skipChildren?: Boolean,
  skip?: (key: string) => boolean,
  name?: string
): void;

// At most TWO reactive nodes per element (#3388) — one when nothing flows
// through `children`:
//
// - The children `insert` effect stays separate. It OWNS the child subtree:
//   components, memos and effects created while the children getter runs are
//   disposed when it reruns, so folding it into the attribute effect would
//   tear the children down and rebuild them on every attribute change. When
//   the source is a plain object (no accessor, no proxy) whose `children` is
//   a data property, the value is inserted directly — `insert` with a
//   non-function creates no effect at all. Compiled JSX children are getters
//   and keep the effect path.
// - `ref` FOLDS into the attribute effect. It is collected with the other
//   props in the compute half and applied in the commit half only when its
//   identity differs from the last applied one (`prevProps.ref`, recorded by
//   assign()). `ref()` runs the callback untracked with NO owner — refs
//   deliberately own nothing — so anything a ref callback creates survives
//   the effect rerunning; that is what makes the fold safe.
//
// Sources. A single source is an object, a merge() result or a bare
// accessor. A lone reactive spread compiles to its accessor directly: merging
// one source is pure overhead, and the mergeProps memo would consume a
// hydration id the server-side fast path never allocates (#3105). The
// accessor resolves inside each tracking scope instead. A nullish source
// (`{...props()}` where the optional props are absent, or no source at all)
// is an empty spread: attributes applied by the previous value are removed,
// nothing throws (#3297).
//
// An ARRAY of sources is the union of their own string keys, later sources
// winning per key (Object.assign / merge()'s contract); only the winning
// source's value is read, so a shadowed getter never runs. A function source
// is called inline in the compute half, tracked, once per run — NO memo and
// so NO hydration id, matching the server's `ssrElement` array form. Nullish
// sources are skipped. `skip(key)` → the key is never read nor applied.
//
// `name` is the element's tag as written, emitted by the compiler under
// `sourceNames.bindings`; the attribute effect is labelled `<tag>.spread`
// and the children insert `<tag>.children`, like a compiled hole's. Dev and
// observe runtimes carry the labels — through `spreadName` (render.ts),
// which `effect` and `insert` read while this body runs, so no call site
// below changes shape and production is byte-identical without them.
export function spread(node, props, skipChildren, skip, name) {
  if ("_SOLID_OBSERVE_" && name !== undefined) {
    const outer = spreadName;
    setSpreadName(name);
    try {
      return spread(node, props, skipChildren, skip);
    } finally {
      setSpreadName(outer);
    }
  }
  const prevProps = {};
  const apply = newProps => {
    const r = newProps.ref;
    if (r !== prevProps.ref && (typeof r === "function" || Array.isArray(r))) ref(() => r, node);
    assign(node, newProps, true, prevProps, true);
  };
  if (Array.isArray(props)) {
    effect(() => collectSources({}, props, undefined, skip), apply);
    if ("_SOLID_DEV_") setUnscopedByDesign(node);
    if (!skipChildren && !(skip !== undefined && skip("children")))
      insert(node, () => {
        for (let i = props.length - 1; i >= 0; i--) {
          const s = resolveSource(props[i]);
          if (s != null && entryHas(s, "children")) return entryGet(s, "children");
        }
      });
    if ("_SOLID_DEV_") setUnscopedByDesign(null);
    return prevProps;
  }
  effect(() => {
    const source = resolveSource(props);
    const newProps = {};
    // A merge() proxy is read through its SOURCES, not through the proxy: a
    // spread mixed with other attributes compiles to
    // `spread(el, merge(statics, () => rest))`, and going through the proxy
    // costs merge's `keys()` (a Set plus an own-enumerable scan of every
    // source) and then, per key, a right-to-left `in` walk of the sources.
    // The union of own string keys with later sources overriding earlier
    // — Object.assign order, merge's own contract — is all a spread needs.
    // An omit() proxy likewise is read through its VIEW RECORD — its source
    // walked directly with the hidden keys filtered — never through its
    // traps (a descriptor trap per key, allocating, on every rerun).
    //
    // A view over plain objects only has a RESOLVED TABLE — key → owning
    // leaf, shadowing already applied — built once; on every rerun this
    // effect then does exactly what it did over an eager copy: one read per
    // key, no re-enumeration and no per-key walk of the later sources.
    const table = resolvedTable(source);
    if (table !== undefined) return collectTable(newProps, table, skip);
    if (source != null) {
      const view = viewOf(source);
      if (view instanceof OmitView) collectProps(newProps, view, SOURCE_OMIT, skip);
      else if (view !== undefined) collectSources(newProps, view.sources, view.kinds, skip);
      else collectProps(newProps, source, $PROXY in source ? SOURCE_PROXY : SOURCE_PLAIN, skip);
    }
    return newProps;
  }, apply);
  if ("_SOLID_DEV_") setUnscopedByDesign(node);
  if (!skipChildren && !(skip !== undefined && skip("children"))) {
    if (typeof props !== "function" && props != null && hasStaticKeys(props)) {
      // A plain object's key set can't change reactively — nor can a
      // merge/omit view's over plain objects, and its descriptor trap tells
      // the truth about the owning leaf: no `children` key means nothing to
      // insert, a data property inserts its value with no effect, only a
      // getter needs the tracking scope. So `<Tag {...omit(props, "as")}>`
      // with static children costs no children effect either.
      const desc = Object.getOwnPropertyDescriptor(props, "children");
      if (desc !== undefined) {
        if (desc.get === undefined) insert(node, desc.value);
        else insert(node, () => props.children);
      }
    } else
      insert(node, () => {
        const source = resolveSource(props);
        return source != null && entryHas(source, "children")
          ? entryGet(source, "children")
          : undefined;
      });
  }
  if ("_SOLID_DEV_") setUnscopedByDesign(null);
  return prevProps;
}

// A resolved view table (see `resolvedTable`) into `out`: the owning leaf's
// value per key, children excluded, `skip` honored.
function collectTable(out, table, skip) {
  for (const [prop, leaf] of table) {
    if (typeof prop !== "string" || prop === "children") continue;
    if (skip !== undefined && skip(prop)) continue;
    const v = leaf[prop];
    out[prop] = prop === "style" || prop === "class" ? readShallow(v) : v;
  }
  return out;
}

function resolveSource(s) {
  return typeof s === "function" ? s() : s;
}

// `key in s` / `s[key]` for one resolved, non-null spread source: an omit()
// proxy answers from its view record (the filter, then its source), anything
// else — a plain object, a store, a merge() proxy — as itself.
function entryHas(s, key) {
  const view = viewOf(s);
  return view instanceof OmitView ? sourceHas(view, SOURCE_OMIT, key) : key in s;
}
function entryGet(s, key) {
  const view = viewOf(s);
  return view instanceof OmitView ? sourceGet(view, SOURCE_OMIT, key) : s[key];
}

// Layered sources into `out`. Every function source is resolved once, up
// front, and a merge() proxy among them contributes its flattened sources in
// place — each entry with its KIND (see `SourceKind`), so the per-key walk
// below asks nothing of a proxy but the read itself; keys are then collected
// left-to-right (Object.assign order — the order assign() applies them in,
// which `type`/`value`/`min`/`max` style pairs care about), and a key any
// LATER source has is skipped unread. `sourceHas` is merge()'s own
// resolution test, so a proxy source (store) answers through its `has` trap
// rather than a per-key descriptor trap, and an omit view answers from its
// filter.
function collectSources(out, sources, kinds, skip) {
  const resolved = [];
  const resolvedKinds = [];
  for (let i = 0; i < sources.length; i++)
    pushEntry(resolved, resolvedKinds, sources[i], kinds !== undefined ? kinds[i] : SOURCE_MEMO);
  for (let i = 0; i < resolved.length; i++)
    collectProps(out, resolved[i], resolvedKinds[i], skip, resolved, resolvedKinds, i + 1);
  return out;
}

// One source into the resolved entry lists. A known plain / omit-record /
// proxy entry (a merge's leaf) joins as is. Anything else — a function (the
// compiler's `() => rest`, merge's memo) resolved once — is classified: a
// merge() proxy contributes its leaves, an omit() proxy its record, a proxy
// is walked through its traps, and nothing nullish contributes at all.
function pushEntry(resolved, kinds, s, kind) {
  if (kind !== SOURCE_MEMO) {
    resolved.push(s);
    kinds.push(kind);
    return;
  }
  s = resolveSource(s);
  if (s == null) return;
  const view = viewOf(s);
  if (view instanceof OmitView) {
    resolved.push(view);
    kinds.push(SOURCE_OMIT);
  } else if (view !== undefined) {
    const f = view.sources,
      k = view.kinds;
    for (let j = 0; j < f.length; j++) pushEntry(resolved, kinds, f[j], k[j]);
  } else {
    resolved.push(s);
    kinds.push($PROXY in s ? SOURCE_PROXY : SOURCE_PLAIN);
  }
}

// One layer of a spread source into `out`: own string keys, `children`
// excluded (it has its own insert), `ref` carried through for the commit
// half, object-valued style/class read HERE, tracked (see readShallow()).
// With `later` (the sources after this one, from index `from`), a key one of
// them defines is shadowed and never read here.
function collectProps(out, s, kind, skip, later?, laterKinds?, from?) {
  const keys = sourceKeys(s, kind);
  outer: for (let i = 0; i < keys.length; i++) {
    const prop = keys[i];
    if (typeof prop !== "string" || prop === "children") continue;
    if (skip !== undefined && skip(prop)) continue;
    if (later !== undefined)
      for (let j = from; j < later.length; j++)
        if (sourceHas(later[j], laterKinds[j], prop)) continue outer;
    const v = sourceGet(s, kind, prop);
    out[prop] = prop === "style" || prop === "class" ? readShallow(v) : v;
  }
}

/** Compiler-emitted primitive; not for hand-written code. @internal */
export function assign(
  node: Element,
  props: any,
  skipChildren?: Boolean,
  prevProps?: any,
  skipRef?: Boolean
): void;

export function assign(node, props, skipChildren, prevProps = {}, skipRef = false) {
  if ("_SOLID_DEV_") tagElement(node);
  const nodeName = node.nodeName;
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], skipRef, nodeName);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) insertExpression(node, normalize(props.children, undefined, false));
      continue;
    }
    prevProps[prop] = assignProp(node, prop, props[prop], prevProps[prop], skipRef, nodeName);
  }
}

function classListToObject(classList) {
  if (Array.isArray(classList)) {
    const result = {};
    flattenClassList(classList, result);
    classList = result;
  }
  if (classList && typeof classList === "object") {
    const result = {},
      keys = Object.keys(classList);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      if (!classList[key]) continue;
      const classNames = key.trim().split(/\s+/);
      for (let j = 0, nameLen = classNames.length; j < nameLen; j++)
        classNames[j] && (result[classNames[j]] = true);
    }
    return result;
  }
  return classList;
}

function flattenClassList(list, result) {
  for (let i = 0, len = list.length; i < len; i++) {
    const item = list[i];
    if (Array.isArray(item)) flattenClassList(item, result);
    else if (typeof item === "object" && item != null) Object.assign(result, item);
    // clsx-style composition: standalone booleans are ignored so guard
    // expressions like `cond && "active"` never emit a "true" class (#3189).
    else if (typeof item !== "boolean" && (item || item === 0)) result[item] = true;
  }
}

function assignProp(node, prop, value, prev, skipRef, nodeName) {
  if (prop === "style") return (style(node, value, prev), value);
  if (prop === "class") return (className(node, value, prev), value);
  // dom with state may differs from reactive state
  // dom value derives from reactive state
  if (value === prev && DOMWithState[nodeName]?.[prop] !== 1) return prev;
  if (prop === "ref") {
    if (!skipRef && value) ref(() => value, node);
    return value;
  }

  let c;
  const hasNamespace = prop.indexOf(":") > -1;

  // Only `on` + an uppercase letter is an event; a lowercase `onclick` is an
  // attribute. No regex on this per-prop path: a key not starting with `on`
  // pays one `startsWith`.
  if (!hasNamespace && prop.startsWith("on") && (c = prop.charCodeAt(2)) > 64 && c < 91) {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      // prev is the exact attached listener. Tuple wrappers carry their
      // authored tuple so unrelated spread reruns retain that same listener.
      if (Array.isArray(value) && typeof prev === "function" && prev[$$EVENT_TUPLE] === value)
        return prev;
      node.removeEventListener(name, prev, typeof prev !== "function" && prev);
    }
    if (delegate || value) {
      const attached = addEvent(node, name, value, delegate);
      delegate && delegateEvents([name]);
      if (!delegate) return attached;
    }
  } else if (
    (hasNamespace && prop.slice(0, 5) === "prop:") ||
    ChildProperties.has(prop) ||
    DOMWithState[nodeName]?.[prop]
  ) {
    if (hasNamespace) prop = prop.slice(5);
    else if (isHydrating(node)) return value; // TODO IS this correct?
    if (prop === "value" && nodeName === "SELECT")
      queueMicrotask(() => (node.value = value)) || (node.value = value);
    else if (
      (prop === "value" || prop === "defaultValue") &&
      (nodeName === "INPUT" || nodeName === "TEXTAREA")
    )
      // Compiler parity: direct bindings emit `el.value = v ?? ""` for
      // input/textarea — nullish must clear the field, not stringify (#2957).
      node[prop] = value ?? "";
    else node[prop] = value;
  } else {
    const ns = hasNamespace && Namespaces[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, prop, value);
  }
  return value;
}
