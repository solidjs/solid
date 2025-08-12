import { getNextElement, insert, spread, SVGElements, hydrate as hydrateCore } from "./client.js";
import {
  createSignal,
  createMemo,
  onCleanup,
  untrack,
  splitProps,
  JSX,
  createRoot,
  sharedConfig,
  enableHydration,
  $DEVCOMP,
  ComponentProps,
  ValidComponent,
  createEffect,
  getOwner,
  runWithOwner
} from "solid-js";

export * from "./client.js";

export {
  For,
  Show,
  Suspense,
  SuspenseList,
  Switch,
  Match,
  Index,
  ErrorBoundary,
  mergeProps
} from "solid-js";

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
  mount?: Node;
  useShadow?: T;
  isSVG?: S;
  ref?:
    | (S extends true ? SVGGElement : HTMLDivElement)
    | ((
        el: (T extends true ? { readonly shadowRoot: ShadowRoot } : {}) &
          (S extends true ? SVGGElement : HTMLDivElement)
      ) => void);
  children: JSX.Element;
}) {
  const { useShadow } = props,
    marker = document.createTextNode(""),
    mount = () => props.mount || document.body,
    owner = getOwner();
  let content: undefined | (() => JSX.Element);
  let hydrating = !!sharedConfig.context;

  createEffect(
    () => {
      // basically we backdoor into a sort of renderEffect here
      if (hydrating) (getOwner() as any).user = hydrating = false;
      content || (content = runWithOwner(owner, () => createMemo(() => props.children)));
      const el = mount();
      if (el instanceof HTMLHeadElement) {
        const [clean, setClean] = createSignal(false);
        const cleanup = () => setClean(true);
        createRoot(dispose => insert(el, () => (!clean() ? content!() : dispose()), null));
        onCleanup(cleanup);
      } else {
        const container = createElement(props.isSVG ? "g" : "div", props.isSVG),
          renderRoot =
            useShadow && container.attachShadow
              ? container.attachShadow({ mode: "open" })
              : container;

        Object.defineProperty(container, "_$host", {
          get() {
            return marker.parentNode;
          },
          configurable: true
        });
        insert(renderRoot, content);
        el.appendChild(container);
        props.ref && (props as any).ref(container);
        onCleanup(() => el.removeChild(container));
      }
    },
    undefined,
    { render: !hydrating }
  );
  return marker;
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
  const [, others] = splitProps(props, ["component"]);
  return createDynamic(() => props.component, others as ComponentProps<T>);
}
