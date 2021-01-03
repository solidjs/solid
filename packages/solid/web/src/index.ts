import { insert, spread } from "./runtime";
import { createSignal, createMemo, onCleanup, untrack, splitProps, Component, JSX, createRoot } from "solid-js";

export * from "./runtime";

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
} from "solid-js";

export * from "./server-mock";
export const isServer = false;

export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  isSVG?: boolean;
  children: JSX.Element;
}) {
  const hydration = globalThis._$HYDRATION;
  const { useShadow } = props,
    marker = document.createTextNode(""),
    mount = props.mount || document.body;

  // don't render when hydrating
  function renderPortal() {
    if (hydration && hydration.context && hydration.context.registry) {
      const [s, set] = createSignal(false);
      queueMicrotask(() => set(true));
      return () => s() && props.children;
    } else return () => props.children;
  }

  if (mount instanceof HTMLHeadElement) {
    let dispose: () => void;
    const [clean, setClean] = createSignal(false);
    createRoot(disposer => {
      dispose = disposer;
      insert(mount, () => !clean() && renderPortal()(), null);
    });
    onCleanup(() => {
      setClean(true);
      dispose();
    })
  } else {
    const container = props.isSVG
        ? document.createElementNS("http://www.w3.org/2000/svg", "g")
        : document.createElement("div"),
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
  props: T & { children?: any; component?: Component<T> | string | keyof JSX.IntrinsicElements }
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
