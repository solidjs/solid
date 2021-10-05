import { getNextElement, insert, spread, SVGElements } from "./client";
import {
  createSignal,
  createMemo,
  onCleanup,
  untrack,
  splitProps,
  Component,
  JSX,
  createRoot,
  sharedConfig,
  Accessor
} from "solid-js";

export * from "./client";

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

export * from "./server-mock";
export const isServer = false;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createElement(tagName: string, isSVG = false): HTMLElement | SVGElement {
  return isSVG ? document.createElementNS(SVG_NAMESPACE, tagName) : document.createElement(tagName);
}

/**
 * renders components somewhere else in the DOM
 * 
 * Useful for inserting modals and tooltips outside of an cropping layout. If no mount point is given, the portal is inserted in document.body; it is wrapped in a `<div>` unless the target is document.head or `isSVG` is true. setting `useShadow` to true places the element in a shadow root to isolate styles.
 * 
 * @description https://www.solidjs.com/docs/latest/api#%3Cportal%3E
 */
export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  isSVG?: boolean;
  children: JSX.Element;
}) {
  const { useShadow } = props,
    marker = document.createTextNode(""),
    mount = props.mount || document.body;

  // don't render when hydrating
  function renderPortal() {
    if (sharedConfig.context) {
      const [s, set] = createSignal(false);
      queueMicrotask(() => set(true));
      return () => s() && props.children;
    } else return () => props.children;
  }

  if (mount instanceof HTMLHeadElement) {
    const [clean, setClean] = createSignal(false);
    const cleanup = () => setClean(true);
    createRoot(dispose => insert(mount, () => (!clean() ? renderPortal()() : dispose()), null));
    onCleanup(() => {
      if (sharedConfig.context) queueMicrotask(cleanup);
      else cleanup();
    });
  } else {
    const container = createElement(props.isSVG ? "g" : "div", props.isSVG),
      renderRoot =
        useShadow && container.attachShadow ? container.attachShadow({ mode: "open" }) : container;

    Object.defineProperty(container, "host", {
      get() {
        return marker.parentNode;
      }
    });
    insert(renderRoot, renderPortal());
    mount.appendChild(container);
    (props as any).ref && (props as any).ref(container);
    onCleanup(() => mount.removeChild(container));
  }
  return marker;
}

type DynamicProps<T> = T & {
  children?: any;
  component?: Component<T> | string | keyof JSX.IntrinsicElements;
};
/**
 * renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://www.solidjs.com/docs/latest/api#%3Cdynamic%3E
 */
export function Dynamic<T>(props: DynamicProps<T>): Accessor<JSX.Element> {
  const [p, others] = splitProps(props, ["component"]);
  return createMemo(() => {
    const component = p.component as Function | string;
    switch (typeof component) {
      case "function":
        return untrack(() => component(others));

      case "string":
        const isSvg = SVGElements.has(component);
        const el = sharedConfig.context ? getNextElement() : createElement(component, isSvg);
        spread(el, others, isSvg);
        return el;

      default:
        break;
    }
  });
}
