import { ssr, ssrSpread } from "./syncSSR";
import { splitProps, Component } from "solid-js";

export * from "./syncSSR";

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
      return ssr([`<${comp} `, ">", `</${comp}>`], ssrSpread(sOthers), local.children || "");
    }
  }
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  return "";
}
