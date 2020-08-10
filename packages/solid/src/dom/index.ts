import { insert, spread } from "./runtime";
import { onCleanup, sample, splitProps, Component } from "../index.js";

export * from "./runtime";
export { For, Match, Show, Suspense, SuspenseList, Switch, Index } from "../index.js";

export function Portal(props: { mount?: HTMLElement; useShadow?: boolean; children: JSX.Element }) {
  const containerNeeded = !props.mount || typeof props.children === "string";
  const { useShadow } = props,
    container = containerNeeded ? document.createElement("div") : props.mount!,
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
  if (containerNeeded) mount.appendChild(container);
  (props as any).ref && (props as any).ref(container);
  onCleanup(() => containerNeeded && mount.removeChild(container));
  return marker;
}

export function Dynamic<T>(
  props: T & { component?: Component<T> | string | keyof JSX.IntrinsicElements }
): () => JSX.Element {
  const [p, others] = splitProps(props, ["component"]);
  return () => {
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
  };
}
