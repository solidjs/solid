import { ssrElement } from "./server.js";
import {
  createComponent,
  createMemo,
  omit,
  getOwner,
  getNextChildId,
  NotReadyError,
  type Component
} from "solid-js";
import type { JSX } from "../src/jsx.js";

export * from "./server.js";
export * from "../src/response.js";
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
  // Mirrors the client exactly: a factory-level memo over the source, then a
  // per-instance memo that applies props. An async source needs no bespoke
  // handling — the (async-aware, non-`sync`) server memo suspends the read
  // while pending, and the nearest boundary owns it and streams.
  //
  // Notably the pending read must NOT be registered as a renderer-blocking
  // promise: that gates the shell flush on the source, so the boundary never
  // shows its fallback and a slow source stalls the whole document. With no
  // boundary to defer to the read becomes a root hole and resolveRootHoles
  // blocks the shell on it anyway — correct, since there is nothing else to
  // do.
  //
  // `serialize: false` because the resolved component must never cross the
  // wire (it isn't serializable, and the client re-runs `source()` during
  // hydration anyway, the same way lazy() re-imports its module). The owner
  // id is still allocated, so hydration keys stay aligned with the client.
  const cached = createMemo(source as () => any, { serialize: false });
  return props => {
    return createMemo(
      () => {
        const c: unknown = cached();
        if (c) {
          if (typeof c === "function") return (c as Function)(props);
          if (typeof c === "string") {
            return ssrElement(c, props, undefined, true) as unknown as JSX.Element;
          }
        }
      },
      { sync: true } as any
    ) as unknown as JSX.Element;
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

/**
 * Portals are client-only islands: the server renders nothing for them —
 * `props.children` is never evaluated, no async is started, and nothing is
 * serialized. The client renders the content fresh once hydration settles.
 * Throwing here instead (as earlier betas did) is strictly worse: an ancestor
 * `Errored` catches it and bakes the error fallback into the streamed HTML
 * for a tree that renders fine client-side (#2876).
 *
 * The one thing both sides must still agree on is the parent's child-id
 * counter: the client Portal scopes its internals under one owner (one slot),
 * so consume the matching slot here or every hydration id after the portal
 * drifts.
 */
export function Portal(props: { mount?: Element; children: JSX.Element }) {
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
  return undefined as unknown as JSX.Element;
}
