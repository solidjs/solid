import { insert, spread } from "./runtime";
import { createMemo, onCleanup, untrack, splitProps, Component } from "../index.js";

export * from "./runtime";
export {
  renderToString,
  renderDOMToString,
  ssr
} from "./asyncSSR";

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
  const { useShadow } = props,
    marker = document.createTextNode(""),
    mount = props.mount || document.body;

  if (mount instanceof HTMLHeadElement) {
    insert(
      mount,
      () => props.children,
      null
    );
  } else {
    const container = document.createElement("div"),
      renderRoot =
        useShadow && container.attachShadow ? container.attachShadow({ mode: "open" }) : container;

    Object.defineProperty(container, "host", {
      get() {
        return marker.parentNode;
      }
    });
    insert(
      renderRoot,
      () => props.children
    );
    mount.appendChild(container);
    (props as any).ref && (props as any).ref(container);
    onCleanup(() => mount.removeChild(container));
  }
  return marker;
}

export function Dynamic<T>(
  props: T & { component?: Component<T> | string | keyof JSX.IntrinsicElements }
): () => JSX.Element {
  const [p, others] = splitProps(props, ["component"]);
  return createMemo(() => {
    const comp = p.component,
      t = typeof comp;

    if (comp) {
      if (t === "function") return untrack(() => (comp as Function)(others as any));
      else if (t === "string") {
        const el = document.createElement(comp as string);
        spread(el, others);
        return el;
      }
    }
  });
}
