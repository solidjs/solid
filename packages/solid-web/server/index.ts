import { ssrElement } from "./server.js";
import { splitProps, type JSX, type ValidComponent, type ComponentProps } from "solid-js";

export * from "./server.js";

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

export function createDynamic<T extends ValidComponent>(
  component: () => T | undefined,
  props: ComponentProps<T>
): JSX.Element {
  const comp = component(),
    t = typeof comp;

  if (comp) {
    if (t === "function") return (comp as Function)(props);
    else if (t === "string") {
      return ssrElement(comp as string, props, undefined, true);
    }
  }
}

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | undefined;
};

export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const [, others] = splitProps(props, ["component"]);
  return createDynamic(() => props.component, others as ComponentProps<T>);
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  return "";
}
