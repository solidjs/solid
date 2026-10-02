import {
  assign,
  createComponent,
  dynamicProperty,
  insert,
  MathMLElements,
  Namespaces,
  spread,
  SVGElements,
  untrack
} from "@solidjs/web";

type ExpandableNode = Node & { [key: string]: any };
type Props = { [key: string]: any };

// Tags h() thunks so consumers can distinguish them from user-written
// accessors and invoke them once rather than wrapping them in an effect.
const $ELEMENT: unique symbol = Symbol("hyper-element");
// Marks callback props that have already been wrapped (see the
// prop-loop below) so re-passing them through nested `h(Comp, ...)`
// calls is idempotent — important for identity stability across
// component boundaries.
const $WRAPPED: unique symbol = Symbol("hyper-wrapped");

export type HyperElement = {
  (): ExpandableNode | ExpandableNode[];
  [$ELEMENT]: true;
};

export type HyperScript = {
  (children: any[]): ExpandableNode[];
  (...args: any[]): HyperElement;
  Fragment: (props: { children: any }) => any;
};

// Recursively invokes h() thunks (and walks arrays containing them) so a
// callback's return value lands in the consumer pre-rendered.
function resolveThunks(value: any): any {
  if (typeof value === "function" && (value as any)[$ELEMENT]) return resolveThunks(value());
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = resolveThunks(value[i]);
    return out;
  }
  return value;
}

// Common arities (1 and 2) are hand-shaped so the wrapped function has
// the right native `length` without paying for `defineProperty`. 1-arity
// covers most render-props and 1-arity event handlers; 2-arity covers
// `mapArray` row callbacks that take an index. Anything higher falls
// back to rest-args + `apply` and a one-shot `defineProperty`.
function wrapCallback(orig: any): any {
  let w: any;
  if (orig.length === 1) {
    w = function (this: any, a: any) {
      return resolveThunks(orig.call(this, a));
    };
  } else if (orig.length === 2) {
    w = function (this: any, a: any, b: any) {
      return resolveThunks(orig.call(this, a, b));
    };
  } else {
    w = function (this: any, ...args: any[]) {
      return resolveThunks(orig.apply(this, args));
    };
    Object.defineProperty(w, "length", { value: orig.length });
  }
  w[$WRAPPED] = true;
  return w;
}

// A fresh props object from descriptors, with `getters` (zero-arity function
// values) turned into getters. The caller's object is never written to: an
// h() element materializes again each time its consumer re-reads it (a
// `Show` re-showing its children), and must find its props as written.
function ownProps(d: PropertyDescriptorMap, getters: string[]): Props {
  for (let i = 0; i < getters.length; i++) d[getters[i]].configurable = true;
  const props = Object.defineProperties({}, d);
  for (let i = 0; i < getters.length; i++) dynamicProperty(props, getters[i]);
  return props;
}

// Zero-arity props become getters (JSX-getter parity).
// Higher-arity callbacks get wrapped so any tagged thunks
// they return are materialized at the call site — otherwise
// a render-prop consumer (`mapArray`-style `For`/`Index`,
// any third-party JSX-compiled component that re-invokes a
// callback with arguments) would store the raw thunk and
// re-invoke it on every parent change, re-mounting stable
// children. `this` is preserved via `.call`/`.apply`; arity
// is preserved so consumers that introspect `cb.length`
// (e.g. `mapArray` deciding whether to allocate an index
// signal) see the original signature. A props object that needs
// none of this (a store, a `merge()` view) is passed through as is.
function componentProps(src: Props | undefined, children: any[]): Props {
  const d: PropertyDescriptorMap = src ? Object.getOwnPropertyDescriptors(src) : {};
  let rewritten = !src;
  if (children.length) {
    d.children = {
      value: children.length > 1 ? children : children[0],
      writable: true,
      enumerable: true,
      configurable: true
    };
    rewritten = true;
  }
  const getters: string[] = [];
  for (const k in d) {
    const v = d[k].value;
    if (typeof v !== "function") continue;
    if (!v.length) getters.push(k);
    else if (!v[$ELEMENT] && !v[$WRAPPED]) {
      d[k] = { ...d[k], value: wrapCallback(v) };
      rewritten = true;
    }
  }
  return rewritten || getters.length ? ownProps(d, getters) : src!;
}

// Inspired by https://github.com/hyperhype/hyperscript
function h(...rawArgs: any[]): any {
  if (rawArgs.length === 1 && Array.isArray(rawArgs[0])) return rawArgs[0];
  const thunk = (() => untrack(() => materialize(rawArgs))) as unknown as HyperElement;
  thunk[$ELEMENT] = true;
  return thunk;
}

function materialize(args: any[]): ExpandableNode | ExpandableNode[] {
  let e: ExpandableNode | undefined;
  let classes: string[] = [];
  let multiExpression = false;
  args = args.slice();

  function item(l: any) {
    if (l == null) return;
    const type = typeof l;
    if ("string" === type) {
      if (!e) parseClass(l);
      else e.appendChild(document.createTextNode(l));
    } else if (
      "number" === type ||
      "boolean" === type ||
      "bigint" === type ||
      "symbol" === type ||
      l instanceof Date ||
      l instanceof RegExp
    ) {
      (e as Node).appendChild(document.createTextNode(l.toString()));
    } else if (Array.isArray(l)) {
      for (let i = 0; i < l.length; i++) item(l[i]);
    } else if (l instanceof Element) {
      insert(e as Element, l, multiExpression ? null : undefined);
    } else if ("object" === type) {
      let dynamic = false;
      let rewritten = false;
      const d = Object.getOwnPropertyDescriptors(l);
      const getters: string[] = [];
      for (const k in d) {
        if (k === "class" && classes.length !== 0) {
          const staticClasses = classes;
          const cls = d[k].value;
          d[k] = {
            ...d[k],
            value:
              typeof cls === "function" ? () => [...staticClasses, cls()] : [...staticClasses, l[k]]
          };
          classes = [];
          rewritten = true;
        }
        if (typeof d[k].value === "function" && k !== "ref" && !/^on[A-Z]/.test(k)) {
          getters.push(k);
          dynamic = true;
        } else if (d[k].get) dynamic = true;
      }
      const props = rewritten || getters.length ? ownProps(d, getters) : l;
      dynamic
        ? spread(e as Element, props, !!args.length)
        : assign(e as Element, props, !!args.length);
    } else if ("function" === type) {
      if (!e) {
        const first = args[0];
        const src: Props | undefined =
          first == null ||
          (typeof first === "object" && !Array.isArray(first) && !(first instanceof Element))
            ? args.shift() || undefined
            : undefined;
        e = createComponent(l, componentProps(src, args)) as ExpandableNode;
        // Drain nested h() thunks so downstream sees the real render result.
        while (typeof e === "function" && (e as any)[$ELEMENT]) e = (e as any)();
        args = [];
      } else if ((l as any)[$ELEMENT]) item(l());
      else {
        // A thunk returned from an accessor is materialized in the insert's
        // tracking pass, where JSX would create the component. Passed through,
        // it lands in the inner pass, which re-runs whenever the component's
        // output changes and would create the component again each time.
        const accessor = l;
        insert(e as Element, () => resolveThunks(accessor()), multiExpression ? null : undefined);
      }
    }
  }

  if (typeof args[0] === "string") detectMultiExpression(args);
  while (args.length) item(args.shift());
  if (e instanceof Element && classes.length) e.classList.add(...classes);
  return e as ExpandableNode;

  function parseClass(string: string) {
    // Does not understand escaped CSS specials; see
    // https://mathiasbynens.be/notes/css-escapes.
    const m = string.split(/([\.#]?[^\s#.]+)/);
    if (/^\.|#/.test(m[1])) e = document.createElement("div");
    for (let i = 0; i < m.length; i++) {
      const v = m[i],
        s = v.substring(1, v.length);
      if (!v) continue;
      if (!e)
        e = SVGElements.has(v)
          ? document.createElementNS(Namespaces.svg, v)
          : MathMLElements.has(v)
            ? document.createElementNS(Namespaces.mathml, v)
            : document.createElement(v);
      else if (v[0] === ".") classes.push(s);
      else if (v[0] === "#") e.setAttribute("id", s);
    }
  }
  function detectMultiExpression(list: any[]) {
    for (let i = 1; i < list.length; i++) {
      if (typeof list[i] === "function") {
        multiExpression = true;
        return;
      } else if (Array.isArray(list[i])) {
        detectMultiExpression(list[i]);
      }
    }
  }
}

(h as HyperScript).Fragment = (props: any) => props.children;
export default h as HyperScript;
