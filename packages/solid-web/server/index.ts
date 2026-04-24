import { ssrElement } from "./server.js";
import {
  createComponent,
  omit,
  getOwner,
  getNextChildId,
  createOwner,
  runWithOwner,
  type Component,
  type JSX,
  type ValidComponent,
  type ComponentProps
} from "solid-js";

export * from "./server.js";

export {
  For,
  Show,
  Loading,
  Reveal,
  Switch,
  Match,
  Repeat,
  Errored,
  NoHydration,
  Hydration
} from "solid-js";

export const isServer: boolean = true;
export const isDev: boolean = false;

export function dynamic<T extends ValidComponent>(
  source: () => T | Promise<T> | null | undefined | false
): Component<ComponentProps<T>> {
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
  return props => {
    const memoOwner = createOwner();

    return runWithOwner(memoOwner, () => {
      const comp = source(),
        t = typeof comp;

      if (comp) {
        if (t === "function") return (comp as Function)(props);
        else if (t === "string") {
          return ssrElement(comp as string, props, undefined, true) as unknown as JSX.Element;
        }
      }
    }) as JSX.Element;
  };
}

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const Comp = dynamic<T>(() => props.component as T | null | undefined | false);
  return createComponent(Comp, omit(props, "component") as ComponentProps<T>);
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  throw new Error("Portal is not supported on the server");
}
