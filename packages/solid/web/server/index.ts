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
  // This overrides mergeProps from dom-expressions/src/server.js
  mergeProps
} from "solid-js";

export const isServer: boolean = true;
export const isDev: boolean = false;

// Types for these come from dom-expressions/src/server.d.ts
// These override the functions from dom-expressions that throw on the serverside.
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
  const comp = p.component,
    t = typeof comp;

  if (comp) {
    if (t === "function") return (comp as Function)(others);
    else if (t === "string") {
      return ssrElement(comp as string, others, undefined, true);
    }
  }
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  return "";
}
