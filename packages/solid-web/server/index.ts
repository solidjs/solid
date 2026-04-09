import { ssrElement } from "./server.js";
import {
  omit,
  getOwner,
  getNextChildId,
  createOwner,
  runWithOwner,
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

export function createDynamic<T extends ValidComponent>(
  component: () => T | undefined,
  props: ComponentProps<T>
): JSX.Element {
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
  const memoOwner = createOwner();

  return runWithOwner(memoOwner, () => {
    const comp = component(),
      t = typeof comp;

    if (comp) {
      if (t === "function") return (comp as Function)(props);
      else if (t === "string") {
        return ssrElement(comp as string, props, undefined, true) as unknown as JSX.Element;
      }
    }
  }) as JSX.Element;
}

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | undefined;
};

export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const others = omit(props, "component");
  return createDynamic(() => props.component, others as ComponentProps<T>);
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  throw new Error("Portal is not supported on the server");
}
