import { ssr, ssrSpread, ssrHydrationKey, escape } from "./server";
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

export const isServer = true;

export function spread() {}

export function Dynamic<T>(
  props: T & { children?: any; component?: Component<T> | string | keyof JSX.IntrinsicElements }
) {
  const [p, others] = splitProps(props, ["component"]);
  const comp = p.component,
    t = typeof comp;

  if (comp) {
    if (t === "function") return (comp as Function)(others);
    else if (t === "string") {
      const [local, sOthers] = splitProps(others, ["children"]);
      return ssr(
        [`<${comp}`, ' ', ">", `</${comp}>`],
        ssrHydrationKey(),
        ssrSpread(sOthers),
        escape(local.children || "")
      );
    }
  }
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  return "";
}
