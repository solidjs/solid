
import { insert } from "./runtime";
import { onCleanup, sample } from "../index.js";

export * from "./runtime";
export { For, Match, Show, Suspense, SuspenseList, Switch } from "../index.js"

export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  ref?: (e: HTMLDivElement) => void;
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
  props.ref && props.ref(container);
  onCleanup(() => mount.removeChild(container));
  return marker;
}
