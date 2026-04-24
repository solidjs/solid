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
  Hydration,
  merge as mergeProps
} from "solid-js";

export const isServer: boolean = false;
export const isDev: boolean = "_SOLID_DEV_" as unknown as boolean;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

/**
 * Renders a component tree into a DOM element and returns a dispose function.
 *
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

export const hydrate: typeof hydrateCore = (...args) => {
  enableHydration();
  return hydrateCore(...args);
};

/**
 * Renders components somewhere else in the DOM
 *
 * Useful for inserting modals and tooltips outside of an cropping layout. If no mount point is given, the portal is inserted in document.body; it is wrapped in a `<div>` unless the target is document.head or `isSVG` is true. setting `useShadow` to true places the element in a shadow root to isolate styles.
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
 * async swaps compose with `Loading`/Suspense boundaries the same way as
 * `lazy`.
 *
 * ```typescript
 * const User = dynamic(() => getUserComp(props.id));
 * return <User>client content</User>;
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
 * Renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
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
