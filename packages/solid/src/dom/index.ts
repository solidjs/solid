import { insert, spread } from "./runtime";
import { onCleanup, sample, splitProps, Component, suspend } from "../index.js";

export * from "./runtime";
export { For, Match, Show, Suspense, SuspenseList, Switch, Index } from "../index.js";

export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  children: JSX.Element;
}) {
  const { useShadow } = props,
    container = document.createElement("div"),
    marker = document.createTextNode(""),
    mount = props.mount || document.body,
    renderRoot =
      useShadow && container.attachShadow ? container.attachShadow({ mode: "open" }) : container;

  Object.defineProperty(container, "host", {
    get() {
      return marker.parentNode;
    }
  });
  insert(
    renderRoot,
    sample(() => props.children)
  );
  mount.appendChild(container);
  (props as any).ref && (props as any).ref(container);
  onCleanup(() => mount.removeChild(container));
  return marker;
}

export function Dynamic<T>(
  props: T & { component?: Component<T> | keyof JSX.IntrinsicElements }
): () => JSX.Element {
  const [p, others] = splitProps(props, ["component"]);
  return suspend(() => {
    const comp = p.component,
      t = typeof comp;

    if (comp) {
      if (t === "function") return sample(() => (comp as Function)(others as any));
      else if (t === "string") {
        const el = document.createElement(comp as string);
        spread(el, others);
        return el;
      }
    }
  });
}
