import { getNextElement, insert, spread, SVGElements, hydrate as hydrateCore } from "./client.js";
import {
  createMemo,
  untrack,
  omit,
  JSX,
  sharedConfig,
  enableHydration,
  $DEVCOMP,
  ComponentProps,
  ValidComponent,
  createRenderEffect
} from "solid-js";

export * from "./client.js";

export { For, Show, Suspense, Switch, Match, ErrorBoundary, merge as mergeProps } from "solid-js";

export * from "./server-mock.js";

export const isServer: boolean = false;
export const isDev: boolean = "_SOLID_DEV_" as unknown as boolean;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createElement(tagName: string, isSVG = false, is = undefined): HTMLElement | SVGElement {
  return isSVG
    ? document.createElementNS(SVG_NAMESPACE, tagName)
    : document.createElement(tagName, { is });
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

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | undefined;
};

/**
 * Renders an arbitrary component or element with the given props
 *
 * This is a lower level version of the `Dynamic` component, useful for
 * performance optimizations in libraries. Do not use this unless you know
 * what you are doing.
 * ```typescript
 * const element = () => multiline() ? 'textarea' : 'input';
 * createDynamic(element, { value: value() });
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function createDynamic<T extends ValidComponent>(
  component: () => T | undefined,
  props: ComponentProps<T>
): JSX.Element {
  const cached = createMemo<Function | string | undefined>(component);
  return createMemo(() => {
    const component = cached();
    switch (typeof component) {
      case "function":
        if (isDev) Object.assign(component, { [$DEVCOMP]: true });
        return untrack(() => component(props));

      case "string":
        const isSvg = SVGElements.has(component);
        const el = sharedConfig.context
          ? getNextElement()
          : createElement(
              component,
              isSvg,
              untrack(() => props.is)
            );
        spread(el, props, isSvg);
        return el;

      default:
        break;
    }
  }) as unknown as JSX.Element;
}

/**
 * Renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const others = omit(props, "component");
  return createDynamic(() => props.component, others as ComponentProps<T>);
}
