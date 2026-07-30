import { ssrElement, getRequestEvent, type RequestEvent, type ResponseStub } from "./server.js";
import {
  createComponent,
  createMemo,
  omit,
  onCleanup,
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

/**
 * Server half of `clientOnly`: the wrapped component never renders on the
 * server — the import is never even started — only `props.fallback` is
 * SSR'd. The client build swaps the real component in after load + mount.
 * See the client entry's JSDoc for the full contract.
 */
export function clientOnly<T extends Component<any>>(
  _fn: () => Promise<{ default: T }>,
  _options: { lazy?: boolean } = {}
): Component<ComponentProps<T> & { fallback?: JSX.Element }> {
  return props => props.fallback as JSX.Element;
}

/**
 * Declares the HTTP response status (and optional status text) for the
 * lifetime of the current reactive scope during SSR, writing to the request
 * event's `response` head (core's `ResponseStub`, exposed by the
 * integration).
 *
 * Naming note — this is a scope-tied *declaration*, not a mutation: "while
 * this reactive scope is live, the response has this status." Solid reserves
 * `set*` verbs for event-time mutation; `httpStatus` is called bare in a
 * component or reactive-scope body (like `createSignal`/`onCleanup`) and
 * un-declares on scope disposal.
 *
 * Retraction semantics: the previous `status`/`statusText` are snapshotted
 * at write time and restored when the owning scope is disposed — a boundary
 * that errored, declared a status, and then recovered retracts its write
 * instead of stomping a status a surviving part of the tree legitimately set
 * (e.g. a 404 page whose inner boundary recovers stays a 404). Both the
 * write and the cleanup restore are no-ops once the integration marks the
 * response head `committed` (head derived/sent — status can no longer
 * change). On the client this is a no-op.
 *
 * `<HttpStatusCode>` is the JSX sugar over this primitive.
 */
export function httpStatus(code: number, text?: string): void {
  // `response` is an integration-augmented field (see core's ResponseStub);
  // read it structurally so the primitives work against the bare contract.
  const event = getRequestEvent() as (RequestEvent & { response?: ResponseStub }) | undefined;
  const response = event && event.response;
  if (response && !response.committed) {
    const prevStatus = response.status;
    const prevStatusText = response.statusText;
    response.status = code;
    response.statusText = text;
    onCleanup(() => {
      if (response.committed) return;
      response.status = prevStatus;
      response.statusText = prevStatusText;
    });
  }
}

/**
 * Declares an HTTP response header (or with `append`, appends to one) for
 * the lifetime of the current reactive scope during SSR, writing to the
 * request event's `response` head (core's `ResponseStub`, exposed by the
 * integration).
 *
 * Naming note — this is a scope-tied *declaration*, not a mutation: "while
 * this reactive scope is live, the response has this header." Solid reserves
 * `set*` verbs for event-time mutation; `httpHeader` is called bare in a
 * component or reactive-scope body (like `createSignal`/`onCleanup`) and
 * un-declares on scope disposal.
 *
 * Retraction semantics: the header's prior value is snapshotted at write
 * time and restored when the owning scope is disposed — deleted if there
 * was none — so a boundary that errors or recovers retracts its writes
 * without disturbing values other writers contributed before it. Both the
 * write and the cleanup restore are no-ops once the integration marks the
 * response head `committed` (head derived/sent — headers can no longer
 * change). On the client this is a no-op.
 *
 * `<HttpHeader>` is the JSX sugar over this primitive.
 */
export function httpHeader(name: string, value: string, options?: { append?: boolean }): void {
  const event = getRequestEvent() as (RequestEvent & { response?: ResponseStub }) | undefined;
  const response = event && event.response;
  if (response && !response.committed) {
    const headers = response.headers;
    const prev = headers.get(name);
    if (options && options.append) headers.append(name, value);
    else headers.set(name, value);
    onCleanup(() => {
      if (response.committed) return;
      if (prev === null) headers.delete(name);
      else headers.set(name, prev);
    });
  }
}

export interface HttpStatusCodeProps {
  code: number;
  text?: string;
}

/**
 * JSX sugar over the `httpStatus` primitive: declares the response status
 * for the lifetime of the surrounding scope during SSR. See `httpStatus`
 * for the full semantics (snapshot/restore retraction, `committed` guard).
 */
export function HttpStatusCode(props: HttpStatusCodeProps): JSX.Element {
  httpStatus(props.code, props.text);
  return null as unknown as JSX.Element;
}

export interface HttpHeaderProps {
  name: string;
  value: string;
  append?: boolean;
}

/**
 * JSX sugar over the `httpHeader` primitive: declares a response header for
 * the lifetime of the surrounding scope during SSR. See `httpHeader` for
 * the full semantics (snapshot/restore retraction, `committed` guard).
 */
export function HttpHeader(props: HttpHeaderProps): JSX.Element {
  httpHeader(props.name, props.value, { append: props.append });
  return null as unknown as JSX.Element;
}
