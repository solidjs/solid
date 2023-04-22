import { ssrElement } from "./server.js";
import { splitProps, Component, JSX } from "solid-js";

export * from "./server";

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

export const isServer: boolean = true;
export const isDev: boolean = false;

export function render() {}
export function hydrate() {}
export function insert() {}
export function spread() {}
export function addEventListener() {}
export function delegateEvents(): void {}

export function Dynamic<T>(
  props: T & { children?: any; component?: Component<T> | string | keyof JSX.IntrinsicElements }
) {
  const [p, others] = splitProps(props, ["component"]);
  return createDynamicComponent(() => p.component, others);
}

export function createDynamicComponent<T>(
  comp: Component<T> | string | keyof JSX.IntrinsicElements,
  props: T & { children?: any }
) {
  const t = typeof comp;

  if (t === "function") return (comp as Function)(props);
  else if (t === "string") {
    return ssrElement(comp as string, props, undefined, true);
  }
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  return "";
}
