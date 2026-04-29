import {
  getNextElement,
  insert,
  spread,
  SVGElements,
  MathMLElements,
  Namespaces,
  render as renderCore,
  hydrate as hydrateCore
} from "./client.js";
import {
  createComponent,
  createMemo,
  untrack,
  omit,
  JSX,
  sharedConfig,
  enableHydration,
  enforceLoadingBoundary,
  flush,
  $DEVCOMP,
  Component,
  ComponentProps,
  ValidComponent,
  createRenderEffect
} from "solid-js";

export * from "./client.js";
export * from "./server-mock.js";
export {
  For,
  Show,
  Switch,
  Match,
  Errored,
  Loading,
  Repeat,
  Reveal,
  NoHydration,
  Hydration
} from "solid-js";

import { merge } from "solid-js";

/**
 * Compiler-emitted prop-spread helper. The JSX transform (in
 * `dom-expressions`) emits `mergeProps(...)` calls when compiling prop
 * spreads on components — it is *not* a user-facing API. Application code
 * should import `merge` from `solid-js` directly.
 *
 * @internal
 */
export const mergeProps = merge;

/**
 * Build-time constant indicating whether code is running on the server. This
 * client entry sets it to `false`; the matching server entry (`@solidjs/web`
 * resolved through the `solid` server export condition) sets it to `true`.
 *
 * Bundlers can dead-code-eliminate branches gated on `isServer`, so guarding
 * browser-only code with `if (!isServer) {…}` keeps it out of the SSR bundle
 * entirely.
 *
 * @example
 * ```ts
 * import { isServer } from "@solidjs/web";
 *
 * if (!isServer) {
 *   // Browser-only: tree-shaken out of the SSR bundle.
 *   window.addEventListener("resize", onResize);
 * }
 * ```
 */
export const isServer: boolean = false;

/**
 * Build-time constant indicating whether code is running in a dev build.
 * Replaced statically (`_SOLID_DEV_`) by the bundler integration, so guards
 * like `if (isDev) {…}` are stripped from production builds.
 *
 * Use this to gate dev-only diagnostics, warnings, or expensive invariants
 * that should never ship to production.
 *
 * @example
 * ```ts
 * import { isDev } from "@solidjs/web";
 *
 * if (isDev) {
 *   console.warn("debug-only path");
 * }
 * ```
 */
export const isDev: boolean = "_SOLID_DEV_" as unknown as boolean;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

/**
 * Renders a component tree into a DOM element. Returns a dispose function
 * that tears the tree down and cleans up reactive scopes when called.
 *
 * @example
 * ```tsx
 * import { render } from "@solidjs/web";
 *
 * const dispose = render(() => <App />, document.getElementById("root")!);
 *
 * // Later, to unmount:
 * dispose();
 * ```
 *
 * @remarks
 * The top-level insert is queued via `insertOptions: { schedule: true }` so
 * its initial DOM attach goes through the effect queue rather than executing
 * inline. This lets the mount participate in transitions: if an uncaught
 * async read surfaces during the initial render (no `Loading` ancestor
 * absorbs it), the mount is held by the transition and attaches atomically
 * once all pending settles. On the no-async happy path the tail `flush()`
 * drains the queued callback so the attach is synchronous by the time
 * `render()` returns. The dev enforcement window scopes
 * `ASYNC_OUTSIDE_LOADING_BOUNDARY` to the initial mount only.
 */
export function render(
  code: () => JSX.Element,
  element: MountableElement,
  init?: unknown,
  options: { renderId?: string } = {}
): () => void {
  // @ts-ignore — replaced at build time
  if ("_DX_DEV_") enforceLoadingBoundary(true);
  try {
    const dispose = (
      renderCore as unknown as (
        code: () => JSX.Element,
        element: MountableElement,
        init: unknown,
        options: { renderId?: string; insertOptions?: { schedule?: boolean } }
      ) => () => void
    )(code, element, init, { ...options, insertOptions: { schedule: true } });
    flush();
    return dispose;
  } finally {
    // @ts-ignore — replaced at build time
    if ("_DX_DEV_") enforceLoadingBoundary(false);
  }
}

/**
 * Resumes a server-rendered tree on the client, attaching event listeners
 * and reactive bindings without reconstructing the DOM. Returns a `dispose`
 * function that tears down reactive scopes (DOM nodes are left in place).
 *
 * Use this when the page HTML was produced by `renderToString`,
 * `renderToStringAsync`, or `renderToStream`. For client-only apps, use
 * `render` instead.
 *
 * Pass `options.renderId` to hydrate one of multiple roots emitted by a
 * server render that used the same id.
 *
 * @example
 * ```tsx
 * import { hydrate } from "@solidjs/web";
 *
 * hydrate(() => <App />, document.getElementById("root")!);
 * ```
 */
export const hydrate: typeof hydrateCore = (...args) => {
  enableHydration();
  return hydrateCore(...args);
};

/**
 * Renders its children into a different part of the DOM (modal roots,
 * tooltips, layers that need to escape an `overflow: hidden` ancestor).
 *
 * If `mount` is omitted, the portal attaches to `document.body`. The portal
 * still participates in the parent's reactive scope and disposes when the
 * parent does.
 *
 * @example
 * ```tsx
 * <Portal mount={document.getElementById("modal-root")!}>
 *   <Dialog />
 * </Portal>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/portal
 */
export function Portal<T extends boolean = false, S extends boolean = false>(props: {
  mount?: Element;
  children: JSX.Element;
}) {
  const treeMarker = document.createTextNode(""),
    startMarker = document.createTextNode(""),
    endMarker = document.createTextNode(""),
    mount = () => createElementProxy(props.mount || document.body, treeMarker);
  let content = createMemo(() => [startMarker, props.children]);

  createRenderEffect<[Element, JSX.Element]>(
    () => [mount(), content()],
    ([m, c]) => {
      m.appendChild(endMarker);
      insert(m, c, endMarker);
      return () => {
        let c: Node | null = startMarker;
        while (c && c !== endMarker) {
          const n: Node | null = c.nextSibling;
          m.removeChild(c);
          c = n;
        }
      };
    }
  );
  return treeMarker;
}

/**
 * Returns a stable `Component` whose identity is driven by a reactive (and
 * optionally async) `source`. The returned component can be used anywhere a
 * normal component is used; children and props flow through JSX as usual.
 *
 * `source` may return a component, a native tag name (`'input'`, `'textarea'`,
 * etc.), `undefined`, or a `Promise` of any of the above. A pending promise
 * propagates as `NotReadyError` through the surrounding reactive scope, so
 * async swaps compose with `<Loading>` boundaries the same way as `lazy`.
 *
 * @example
 * ```tsx
 * // `source` can return either a custom Component or a native tag
 * // name — they're interchangeable, and the returned reference is a
 * // stable Component you can use anywhere a normal one would go.
 * const Field = dynamic(() => multiline() ? RichTextEditor : "input");
 * return <Field value={value()} onInput={onInput} />;
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function dynamic<T extends ValidComponent>(
  source: () => T | Promise<T> | null | undefined | false
): Component<ComponentProps<T>> {
  const cached = createMemo<Function | string | undefined>(source as () => any, { lazy: true });
  return props => {
    return createMemo(() => {
      const component = cached();
      switch (typeof component) {
        case "function":
          if (isDev) Object.assign(component, { [$DEVCOMP]: true });
          return untrack(() => (component as Function)(props));

        case "string":
          const el = sharedConfig.hydrating
            ? getNextElement()
            : createElement(
                component as string,
                untrack(() => (props as any).is)
              );
          spread(el, props);
          return el;

        default:
          break;
      }
    }) as unknown as JSX.Element;
  };
}

/**
 * Renders an arbitrary custom or native component and forwards the other
 * props. JSX form of `dynamic()` — same primitive, picked at the JSX site.
 *
 * @example
 * ```tsx
 * <Dynamic
 *   component={multiline() ? RichTextEditor : "input"}
 *   value={value()}
 *   onInput={onInput}
 * />
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const Comp = dynamic<T>(() => props.component as T | null | undefined | false);
  return createComponent(Comp, omit(props, "component") as ComponentProps<T>);
}

function createElement(tagName: string, is = undefined): HTMLElement | SVGElement | MathMLElement {
  return (
    SVGElements.has(tagName)
      ? document.createElementNS(Namespaces.svg, tagName)
      : MathMLElements.has(tagName)
        ? document.createElementNS(Namespaces.mathml, tagName)
        : document.createElement(tagName, { is })
  ) as HTMLElement | SVGElement | MathMLElement;
}

function createElementProxy(el: Element, marker: Text) {
  return new Proxy(el, {
    get(target, prop) {
      if (prop === "appendChild" || prop === "insertBefore") {
        return (...args: [Node]) => {
          Object.defineProperty(args[0], "_$host", {
            get: () => marker.parentNode,
            configurable: true
          });
          (target[prop] as any)(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
