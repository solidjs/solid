import { insert, spread, ssrSpread } from "./runtime";
import { ssr } from "./asyncSSR";
import { createSignal, createMemo, onCleanup, untrack, splitProps, Component } from "../index.js";

export * from "./runtime";
export { renderToString, renderDOMToString, ssr } from "./asyncSSR";

export {
  For,
  Show,
  Suspense,
  SuspenseList,
  Switch,
  Match,
  Index,
  ErrorBoundary,
  assignProps
} from "../index.js";

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  const hydration = globalThis._$HYDRATION;
  if (hydration && hydration.asyncSSR) return;
  const { useShadow } = props,
    marker = document.createTextNode(""),
    mount = props.mount || document.body;

  // don't render when hydrating
  function renderPortal() {
    if (hydration && hydration.context && hydration.context.registry) {
      const [s, set] = createSignal(false);
      queueMicrotask(() => set(true));
      return () => s() && props.children;
    } else return () => props.children
  }

  if (mount instanceof HTMLHeadElement) {
    insert(mount, renderPortal(), null);
  } else {
    const container = document.createElement("div"),
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

export function Dynamic<T>(
  props: T & { children?: any,  component?: Component<T> | string | keyof JSX.IntrinsicElements }
): () => JSX.Element {
  const [p, others] = splitProps(props, ["component"]);
  return createMemo(() => {
    const comp = p.component,
      t = typeof comp;

    if (comp) {
      if (t === "function") return untrack(() => (comp as Function)(others as any));
      else if (t === "string") {
        let el;
        if (globalThis._$HYDRATION && globalThis._$HYDRATION.asyncSSR) {
          const [local, sOthers] = splitProps(others, ["children"]);
          el = ssr(
            [`<${comp} `, ">", `</${comp}>`],
            ssrSpread(sOthers),
            local.children || ""
          );
        } else {
          el = document.createElement(comp as string);
          spread(el, others);
        }
        return el;
      }
    }
  });
}
