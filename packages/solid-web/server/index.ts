import { ssrElement } from "./server.js";
import {
  createComponent,
  omit,
  getOwner,
  getNextChildId,
  createOwner,
  runWithOwner,
  type Component
} from "solid-js";
import type { JSX } from "../src/jsx.js";

export * from "./server.js";
export type { JSX } from "../src/jsx.js";

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

/**
 * Build-time constant indicating whether code is running on the server. This
 * is the server entry; the value is `true`. The client entry of `@solidjs/web`
 * sets it to `false`. See the client-entry JSDoc for the canonical guard
 * pattern.
 */
export const isServer: boolean = true;

/**
 * Build-time constant indicating whether code is running in a dev build.
 * The server entry hard-codes `false` (SSR builds are production by
 * convention); the client entry's value is set by `_SOLID_DEV_` substitution.
 */
export const isDev: boolean = false;

export type IntrinsicElement = Extract<keyof JSX.IntrinsicElements, string>;
export type ValidComponent = IntrinsicElement | Component<any> | (string & {});
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

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
