// @ts-nocheck
import {
  createRoot as root,
  createComponent,
  untrack,
  runWithOwner,
  merge as mergeProps,
  flatten,
  createMemo,
  createRenderEffect,
  flush,
  $PROXY,
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
} from "solid-js";

export interface RendererOptions<NodeType> {
  createElement(tag: string, staticProps?: Record<string, unknown>): NodeType;
  createTextNode(value: string): NodeType;
  createSentinel?(): NodeType;
  replaceText(textNode: NodeType, value: string): void;
  isTextNode(node: NodeType): boolean;
  setProperty<T>(node: NodeType, name: string, value: T, prev?: T): void;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  removeNode(parent: NodeType, node: NodeType): void;
  cleanupNodes?(parent: NodeType, nodes: NodeType[]): void;
  getParentNode(node: NodeType): NodeType | undefined;
  getFirstChild(node: NodeType): NodeType | undefined;
  getNextSibling(node: NodeType): NodeType | undefined;
}

/**
 * Options for renderer-owned reactive effects (#3063). Custom renderers and
 * their compiled output can label the render effects created for dynamic
 * inserts and spreads, so dev diagnostics (`OBSERVE.attribution`) can correlate
 * a signal write → application computation → renderer effect → output
 * mutation chain end-to-end. Only meaningful to development diagnostics;
 * production ignores the name.
 */
export interface RendererEffectOptions {
  /** Debug name for the renderer-owned reactive effect (dev mode only). */
  name?: string;
}

export interface Renderer<NodeType> {
  render(code: () => NodeType, node: NodeType): () => void;
  effect<T>(
    fn: (prev?: T) => T,
    effect: (value: T, prev?: T) => void,
    options?: RendererEffectOptions
  ): void;
  memo<T>(fn: () => T, equal: boolean): () => T;
  createComponent<T>(Comp: (props: T) => NodeType, props: T): NodeType;
  createElement(tag: string, staticProps?: Record<string, unknown>): NodeType;
  createTextNode(value: string): NodeType;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  insert<T>(
    parent: any,
    accessor: (() => T) | T,
    marker?: any | null,
    initial?: any,
    options?: RendererEffectOptions
  ): NodeType;
  spread<T extends object>(
    node: any,
    props: T | (() => T) | (T | (() => T) | null | undefined)[] | null | undefined,
    skipChildren?: boolean,
    options?: RendererEffectOptions
  ): void;
  setProp<T>(node: NodeType, name: string, value: T, prev?: T): T;
  mergeProps(...sources: unknown[]): unknown;
  applyRef(
    r: ((element: NodeType) => void) | ((element: NodeType) => void)[],
    element: NodeType
  ): void;
  ref(
    fn: () => ((element: NodeType) => void) | ((element: NodeType) => void)[],
    element: NodeType
  ): void;
}

const transparentOptions = { transparent: true, sync: true };
const syncOptions = { sync: true };

// Copied from @solidjs/web's render.js — same compiled-output contract.
// `scope: true` makes the render effect non-transparent so the hole gets
// its own id scope. memo is NOT transparent (#3033).
const effect = (fn, effectFn, options) =>
  createRenderEffect(
    fn,
    effectFn,
    options ? { sync: true, ...options, transparent: !options.scope } : transparentOptions
  );
const memo = fn => createMemo(() => fn(), syncOptions);

// Renderer-owned effects get stable fallback names so diagnostics and
// attribution can locate updates flowing through renderer output (#3063);
// callers override them via the trailing RendererEffectOptions argument.
// Observe-tier wiring: `"_SOLID_OBSERVE_"` is replaced at build time (true in
// dev and observe builds), so production folds this back to `options`.
const named = (options, fallback) =>
  "_SOLID_OBSERVE_" && (!options || options.name == null)
    ? { ...options, name: fallback }
    : options;

const INNER_OWNED = {};
export function createRenderer<NodeType>(options: RendererOptions<NodeType>): Renderer<NodeType>;

export function createRenderer({
  createElement,
  createTextNode,
  createSentinel = () => createTextNode(""),
  isTextNode,
  replaceText,
  insertNode,
  removeNode,
  cleanupNodes,
  setProperty,
  getParentNode,
  getFirstChild,
  getNextSibling
}) {
  function insert(parent, accessor, marker, initial, options) {
    const onUpdate = options && options.onUpdate;
    let effectOptions = options;
    if (onUpdate) {
      const { onUpdate, ...rest } = options;
      effectOptions = rest;
    }
    effectOptions = named(effectOptions, "renderer insert");
    const multi = marker !== undefined;
    if (multi && !initial) initial = [];
    if (typeof accessor !== "function") {
      accessor = normalize(accessor, multi, true);
      if (typeof accessor !== "function") {
        insertExpression(parent, accessor, initial, marker);
        onUpdate && onUpdate(accessor);
        return;
      }
    }
    if (multi && initial.length === 0) {
      const sentinel = createSentinel();
      insertNode(parent, sentinel, marker);
      initial = [sentinel];
    }
    let current = initial;
    effect(
      prev => {
        const value = normalize(accessor(), multi, true);
        if (typeof value !== "function") return value;
        effect(
          () => normalize(value, multi),
          inner => {
            insertExpression(parent, inner, current, marker);
            current = inner;
            onUpdate && onUpdate(current);
          },
          prev !== undefined && !(options && options.schedule)
            ? { ...effectOptions, schedule: true }
            : effectOptions
        );
        return INNER_OWNED;
      },
      value => {
        if (value === INNER_OWNED) return;
        insertExpression(parent, value, current, marker);
        current = value;
        onUpdate && onUpdate(current);
      },
      effectOptions
    );
  }

  function insertExpression(parent, value, current, marker) {
    if (value === current) return;
    const t = typeof value,
      multi = marker !== undefined;

    if (t === "string" || t === "number") {
      const tc = typeof current;
      if (tc === "string" || tc === "number") {
        replaceText(getFirstChild(parent), value);
      } else {
        cleanChildren(parent, current, marker, createTextNode(value));
      }
    } else if (value == null) {
      cleanChildren(parent, current, marker);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        cleanChildren(parent, current, marker);
      } else {
        if (Array.isArray(current)) {
          if (current.length === 0) {
            appendNodes(parent, value, marker);
          } else reconcileArrays(parent, current, value);
        } else if (current == null) {
          appendNodes(parent, value);
        } else {
          reconcileArrays(parent, (multi && current) || [getFirstChild(parent)], value);
        }
      }
    } else {
      if (Array.isArray(current)) {
        cleanChildren(parent, current, multi ? marker : null, value);
      } else if (current == null || !getFirstChild(parent)) {
        insertNode(parent, value);
      } else replaceNode(parent, value, getFirstChild(parent));
    }
  }

  function normalize(value, multi, doNotUnwrap) {
    value = flatten(value, { skipNonRendered: true, doNotUnwrap });
    if (doNotUnwrap && typeof value === "function") return value;
    if (multi && !Array.isArray(value)) value = [value != null ? value : ""];
    if (Array.isArray(value)) {
      for (let i = 0, len = value.length; i < len; i++) {
        const item = value[i],
          t = typeof item;
        if (t === "string" || t === "number") value[i] = createTextNode(item);
      }
    }
    return value;
  }

  function reconcileArrays(parentNode, a, b) {
    let bLength = b.length,
      aEnd = a.length,
      bEnd = bLength,
      aStart = 0,
      bStart = 0,
      after = getNextSibling(a[aEnd - 1]),
      map = null;

    // `a[]` can name a node that replace/swap already took out of this
    // parent. Prefix/suffix must not treat those as still-live common ends
    // — same drop as the DOM reconcile (#574).
    const isLive = n => n && getParentNode(n) === parentNode;

    while (aStart < aEnd || bStart < bEnd) {
      // common prefix
      if (a[aStart] === b[bStart] && isLive(a[aStart])) {
        aStart++;
        bStart++;
        continue;
      }
      // common suffix
      while (a[aEnd - 1] === b[bEnd - 1] && isLive(a[aEnd - 1])) {
        aEnd--;
        bEnd--;
      }
      // append
      if (aEnd === aStart) {
        const node =
          bEnd < bLength ? (bStart ? getNextSibling(b[bStart - 1]) : b[bEnd - bStart]) : after;

        while (bStart < bEnd) insertNode(parentNode, b[bStart++], node);
        // remove
      } else if (bEnd === bStart) {
        while (aStart < aEnd) {
          if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart]);
          aStart++;
        }
        // swap backward — symmetric end-swap detected. Walk inward with a single
        // stable front anchor (a[aStart]); each move targets the same host
        // position and avoids cross-anchored inserts on reorder-heavy patterns.
      } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
        const anchor = a[aStart];
        do {
          insertNode(parentNode, a[--aEnd], anchor);
          bStart++;
          if (aStart >= aEnd - 1 || bStart >= bEnd) break;
        } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
        // fallback to map
      } else {
        if (!map) {
          map = new Map();
          let i = bStart;

          while (i < bEnd) map.set(b[i], i++);
        }

        const index = map.get(a[aStart]);
        if (index != null) {
          if (bStart < index && index < bEnd) {
            let i = aStart,
              sequence = 1,
              t;

            while (++i < aEnd && i < bEnd) {
              if ((t = map.get(a[i])) == null || t !== index + sequence) break;
              sequence++;
            }

            if (sequence > index - bStart) {
              const node = a[aStart];
              while (bStart < index) insertNode(parentNode, b[bStart++], node);
            } else replaceNode(parentNode, b[bStart++], a[aStart++]);
          } else aStart++;
        } else removeNode(parentNode, a[aStart++]);
      }
    }
  }

  function cleanChildren(parent, current, marker, replacement) {
    if (marker === undefined) {
      let removed;
      while ((removed = getFirstChild(parent))) removeNode(parent, removed);
      replacement && insertNode(parent, replacement);
      return "";
    }
    if (current.length) {
      let inserted = false;
      for (let i = current.length - 1; i >= 0; i--) {
        const el = current[i];
        if (replacement !== el) {
          const isParent = getParentNode(el) === parent;
          if (replacement && !inserted && !i)
            isParent
              ? replaceNode(parent, replacement, el)
              : insertNode(parent, replacement, marker);
          else isParent && removeNode(parent, el);
        } else inserted = true;
      }
    } else if (replacement) insertNode(parent, replacement, marker);
  }

  function appendNodes(parent, array, marker) {
    for (let i = 0, len = array.length; i < len; i++) insertNode(parent, array[i], marker);
  }

  function replaceNode(parent, newNode, oldNode) {
    insertNode(parent, newNode, oldNode);
    removeNode(parent, oldNode);
  }

  function collectNodes(value, nodes) {
    if (Array.isArray(value)) {
      for (let i = 0, len = value.length; i < len; i++) collectNodes(value[i], nodes);
    } else if (value != null && typeof value !== "string" && typeof value !== "number") {
      nodes.push(value);
    }
    return nodes;
  }

  function collectMounted(parent, value) {
    const nodes = collectNodes(value, []);
    if (!nodes.length && (typeof value === "string" || typeof value === "number")) {
      const node = getFirstChild(parent);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  function defaultCleanupNodes(parent, nodes) {
    for (let i = 0, len = nodes.length; i < len; i++) {
      const node = nodes[i];
      if (getParentNode(node) === parent) removeNode(parent, node);
    }
  }

  // Same contract as @solidjs/web's spread (#3388, #3419), minus the DOM
  // specifics: at most TWO reactive nodes per element, one when nothing
  // flows through `children`.
  //
  // - The children `insert` stays separate. It OWNS the child subtree —
  //   components, memos and effects created while the children getter runs
  //   are disposed when it reruns — so folding it into the props effect
  //   would tear the children down and rebuild them on every prop change.
  //   A plain object whose `children` is a data property inserts the value
  //   directly, with no effect at all; a getter keeps the tracking scope.
  // - `ref` FOLDS into the props effect: collected with the other props and
  //   applied in the commit half only when its identity changed. `ref()`
  //   runs the callback untracked with NO owner, so anything a ref creates
  //   survives the effect rerunning.
  //
  // Sources. A single source is an object, a mergeProps() proxy or a bare
  // accessor; an accessor resolves inside each tracking scope, so a lone
  // reactive spread needs no merge and no memo. An ARRAY of sources is the
  // union of their keys, later sources winning per key — only the winning
  // source's value is read, so a shadowed getter never runs — with function
  // sources called inline, once per run. Nullish sources are empty.
  //
  // A caller-supplied name is shared by the child insertion and the props
  // effect (#3063); without one, each gets its own stable dev fallback.
  function spread(node, props, skipChildren, options) {
    const prevProps = {};
    const apply = newProps => {
      for (const prop in prevProps) {
        if (prop in newProps) continue;
        if (prop !== "ref") setProperty(node, prop, undefined, prevProps[prop]);
        delete prevProps[prop];
      }
      for (const prop in newProps) {
        const value = newProps[prop];
        if (value === prevProps[prop]) continue;
        if (prop === "ref") {
          (typeof value === "function" || Array.isArray(value)) && ref(() => value, node);
        } else setProperty(node, prop, value, prevProps[prop]);
        prevProps[prop] = value;
      }
    };
    const childrenOptions = () => named(options, "renderer spread children");
    if (Array.isArray(props)) {
      if (!skipChildren)
        insert(
          node,
          () => {
            for (let i = props.length - 1; i >= 0; i--) {
              const s = resolveSource(props[i]);
              if (s != null && entryHas(s, "children")) return entryGet(s, "children");
            }
          },
          undefined,
          undefined,
          childrenOptions()
        );
      effect(
        () => collectSources({}, props, undefined),
        apply,
        named(options, "renderer spread props")
      );
      return prevProps;
    }
    if (!skipChildren) {
      if (typeof props !== "function" && props != null && hasStaticKeys(props)) {
        // A plain object's key set can't change reactively — nor can a
        // merge/omit view's over plain objects, and its descriptor trap
        // tells the truth about the owning leaf: no `children` key means
        // nothing to insert, a data property inserts its value with no
        // effect, only a getter needs the tracking scope.
        const desc = Object.getOwnPropertyDescriptor(props, "children");
        if (desc !== undefined) {
          if (desc.get === undefined)
            insert(node, desc.value, undefined, undefined, childrenOptions());
          else insert(node, () => props.children, undefined, undefined, childrenOptions());
        }
      } else
        insert(
          node,
          () => {
            const s = resolveSource(props);
            return s != null ? entryGet(s, "children") : undefined;
          },
          undefined,
          undefined,
          childrenOptions()
        );
    }
    effect(
      () => {
        const s = resolveSource(props);
        const newProps = {};
        // A merge() proxy is read through its sources and an omit() proxy
        // through its view record, never through their traps; a view over
        // plain objects through its resolved table, one read per key on
        // every rerun (see @solidjs/web).
        const table = resolvedTable(s);
        if (table !== undefined) {
          for (const [prop, leaf] of table) {
            if (typeof prop !== "string" || prop === "children") continue;
            newProps[prop] = leaf[prop];
          }
          return newProps;
        }
        if (s != null) {
          const view = viewOf(s);
          if (view instanceof OmitView) collectProps(newProps, view, SOURCE_OMIT);
          else if (view !== undefined) collectSources(newProps, view.sources, view.kinds);
          else collectProps(newProps, s, $PROXY in s ? SOURCE_PROXY : SOURCE_PLAIN);
        }
        return newProps;
      },
      apply,
      named(options, "renderer spread props")
    );
    return prevProps;
  }

  function resolveSource(s) {
    return typeof s === "function" ? s() : s;
  }

  // `key in s` / `s[key]` for one resolved, non-null spread source: an
  // omit() proxy answers from its view record, anything else as itself.
  function entryHas(s, key) {
    const view = viewOf(s);
    return view instanceof OmitView ? sourceHas(view, SOURCE_OMIT, key) : key in s;
  }
  function entryGet(s, key) {
    const view = viewOf(s);
    return view instanceof OmitView ? sourceGet(view, SOURCE_OMIT, key) : s[key];
  }

  // Layered sources into `out`. Every function source is resolved once, up
  // front, a merge() proxy among them contributes its flattened sources in
  // place — each entry with its KIND, so the per-key walk asks nothing of a
  // proxy but the read; keys are then collected left-to-right (Object.assign
  // order), and a key any LATER source has is skipped unread. `sourceHas` is
  // merge()'s own resolution test, so a proxy source answers through its
  // `has` trap and an omit view from its filter.
  function collectSources(out, sources, kinds) {
    const resolved = [];
    const resolvedKinds = [];
    for (let i = 0; i < sources.length; i++)
      pushEntry(resolved, resolvedKinds, sources[i], kinds !== undefined ? kinds[i] : SOURCE_MEMO);
    for (let i = 0; i < resolved.length; i++)
      collectProps(out, resolved[i], resolvedKinds[i], resolved, resolvedKinds, i + 1);
    return out;
  }

  // One source into the resolved entry lists (see @solidjs/web).
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

  // One layer of a spread source into `out`: own string keys (one `ownKeys`
  // trap for a renderer's proxy props, no descriptor trap per key),
  // `children` excluded (it has its own insert), `ref` carried through for
  // the commit half. With `later` (the sources after this one, from index
  // `from`), a key one of them defines is shadowed and never read here.
  function collectProps(out, s, kind, later?, laterKinds?, from?) {
    const keys = sourceKeys(s, kind);
    outer: for (let i = 0; i < keys.length; i++) {
      const prop = keys[i];
      if (typeof prop !== "string" || prop === "children") continue;
      if (later !== undefined)
        for (let j = from; j < later.length; j++)
          if (sourceHas(later[j], laterKinds[j], prop)) continue outer;
      out[prop] = sourceGet(s, kind, prop);
    }
    return out;
  }

  function applyRef(r, element) {
    Array.isArray(r) ? r.flat(Infinity).forEach(f => f && f(element)) : r(element);
  }

  function ref(fn, element) {
    const resolved = untrack(fn);
    runWithOwner(null, () => applyRef(resolved, element));
  }

  return {
    render(code, element) {
      let disposer,
        disposed = false,
        mounted = [];
      const cleanup = cleanupNodes || defaultCleanupNodes;
      try {
        root(dispose => {
          disposer = dispose;
          // Accessor wrap: a concrete node would short-circuit insert and
          // skip `schedule`. Evaluate `code()` once; the accessor is stable.
          const tree = code();
          const renderOptions = {
            schedule: true,
            onUpdate(value) {
              mounted = collectMounted(element, value);
            }
          };
          if ("_SOLID_OBSERVE_") renderOptions.name = "renderer render";
          insert(element, () => tree, undefined, undefined, renderOptions);
        });
        // Drain the queued mount so the no-async path is attached by return.
        // Uncaught top-level async holds the initial commit on the active
        // transition and attaches atomically once it settles — same as
        // `@solidjs/web`'s `render`.
        flush();
      } catch (err) {
        if (disposer) disposer();
        cleanup(element, mounted);
        throw err;
      }
      return () => {
        if (disposed) return;
        disposed = true;
        disposer();
        cleanup(element, mounted);
        mounted = [];
      };
    },
    insert,
    spread,
    createElement,
    createTextNode,
    insertNode,
    setProp(node, name, value, prev) {
      setProperty(node, name, value, prev);
      return value;
    },
    mergeProps,
    effect,
    memo,
    createComponent,
    applyRef,
    ref
  };
}
