import { ssr, ssrSpread } from "./asyncSSR";
import { createMemo, untrack, splitProps, Component, JSX } from "solid-js";

export * from "./asyncSSR";

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
): () => JSX.Element {
  const [p, others] = splitProps(props, ["component"]);
  return createMemo(() => {
    const comp = p.component,
      t = typeof comp;

    if (comp) {
      if (t === "function") return untrack(() => (comp as Function)(others as any));
      else if (t === "string") {
        const [local, sOthers] = splitProps(others, ["children"]);
        return ssr([`<${comp} `, ">", `</${comp}>`], ssrSpread(sOthers), local.children || "");
      }
    }
  });
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  return "";
}
