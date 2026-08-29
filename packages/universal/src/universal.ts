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
  flush
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

export interface Renderer<NodeType> {
  render(code: () => NodeType, node: NodeType): () => void;
  effect<T>(fn: (prev?: T) => T, effect: (value: T, prev?: T) => void): void;
  memo<T>(fn: () => T, equal: boolean): () => T;
  createComponent<T>(Comp: (props: T) => NodeType, props: T): NodeType;
  createElement(tag: string, staticProps?: Record<string, unknown>): NodeType;
  createTextNode(value: string): NodeType;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  insert<T>(parent: any, accessor: (() => T) | T, marker?: any | null, initial?: any): NodeType;
  spread<T extends object>(node: any, props: T, skipChildren?: boolean): void;
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
  /** Patch-mode dual driver (compiled output imports this under the
   * DEFAULT-ON patch compiler): runs the compiled body as a dual-phase
   * effect. `createRenderer` synthesizes it — custom renderers just
   * re-export it like every other member. The optional third argument is
   * the compiler's static read manifest (unused by the universal flavor). */
  patchDriver(
    subject: unknown,
    body: (next: any, prev: any, force?: boolean) => void,
    keys?: string[]
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

  // TODO: make this better
  function spread(node, props, skipChildren) {
    const prevProps = {};
    props || (props = {});
    if (!skipChildren) insert(node, () => props.children);
    effect(
      () => {
        const r = props.ref;
        (typeof r === "function" || Array.isArray(r)) && ref(() => r, node);
      },
      () => {}
    );
    effect(
      () => {
        const newProps = {};
        for (const prop in props) {
          if (prop === "children" || prop === "ref") continue;
          newProps[prop] = props[prop];
        }
        return newProps;
      },
      props => {
        for (const prop in prevProps) {
          if (!(prop in props)) {
            setProperty(node, prop, undefined, prevProps[prop]);
            delete prevProps[prop];
          }
        }
        for (const prop in props) {
          const value = props[prop];
          if (value === prevProps[prop]) continue;
          setProperty(node, prop, value, prevProps[prop]);
          prevProps[prop] = value;
        }
      }
    );
    return prevProps;
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
          insert(element, () => tree, undefined, undefined, {
            schedule: true,
            onUpdate(value) {
              mounted = collectMounted(element, value);
            }
          });
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
    ref,
    // Patch-mode dual driver, universal flavor: no store/record seams here,
    // so every compiled body runs through the classic dual-phase effect
    // (compute pass reads with next === prev; commit pass force-applies).
    patchDriver(subject, body) {
      effect(
        () => body(subject, subject, false),
        () => body(subject, undefined, true)
      );
    }
  };
}
