import { ssrElement, getRequestEvent, type RequestEvent, type ResponseStub } from "./server.js";
import {
  createComponent,
  createMemo,
  omit,
  onCleanup,
  getOwner,
  getNextChildId,
  NotReadyError,
  sharedConfig,
  type Component
} from "solid-js";
import type { JSX } from "../jsx/jsx.js";
// The container tier's server half: the runtime's trace plugin rides every
// render's serializer (both faces — it is part of the codec's default
// plugin set), but it is inert until the reactive core answers "is this
// value a traced container".
// Installing solid's projection-trace resolver here arms it for every SSR
// consumer of this entry — no per-app wiring.
import { setContainerTraceResolver } from "../frames/src/frame-container-plugin.js";
import { getProjectionTrace } from "solid-js";

setContainerTraceResolver(getProjectionTrace);

export * from "./server.js";
export * from "./response.js";
export type { JSX } from "../jsx/jsx.js";

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
  const cached = createMemo(source as () => any, { serialize: false } as any);
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
 * Emits early preload hints for a `clientOnly` module: resolves the module's
 * client assets through the manifest seam lazy() uses and registers them as
 * plain link hints (`modulepreload` for js, stylesheet links / inline styles
 * for css, plus explicit preload descriptors) so the browser can start
 * fetching when the HTML arrives instead of when the client bundle evaluates
 * the `clientOnly()` call.
 *
 * Deliberately NOT `registerModule`: that files the module into the
 * serialized hydration asset map, whose contract is "required before
 * hydration" — a clientOnly module is not (the fallback is what hydrates;
 * the real component mounts post-settle). Filing it there would make the
 * client's "was not preloaded before hydration" check lie. Plain hints only.
 *
 * Rendering is never gated on resolution (unlike lazy, nothing downstream
 * needs these assets to hydrate): an async resolver (dev manifest bridge)
 * applies on settle under the boundary that owned the render, best-effort.
 */
function registerClientOnlyPreload(moduleUrl: string): void {
  // Client `solid-js` types don't expose the server `sharedConfig.context`
  // hydration bag (`serialize`, `registerAsset`, …). The server runtime
  // (`server.ts`) is `@ts-nocheck` for the same split.
  const ctx = (sharedConfig as { context?: any }).context;
  if (!ctx?.registerAsset || !ctx.resolveAssets) return;
  const registerAsset = ctx.registerAsset;
  const resolve = ctx.resolveAssets;
  const apply = (assets: Awaited<ReturnType<typeof resolve>> | undefined) => {
    if (!assets) return;
    for (let i = 0; i < assets.css.length; i++) {
      const css = assets.css[i];
      if (typeof css === "string") registerAsset("style", css);
      else registerAsset("inline-style", css);
    }
    if (assets.preloads) {
      for (let i = 0; i < assets.preloads.length; i++) {
        registerAsset("preload", assets.preloads[i]);
      }
    }
    for (let i = 0; i < assets.js.length; i++) registerAsset("module", assets.js[i]);
  };
  const assets = resolve(moduleUrl);
  if (assets && typeof (assets as Promise<unknown>).then === "function") {
    const boundary = ctx._currentBoundaryId;
    (assets as Promise<Awaited<ReturnType<typeof resolve>>>).then(
      resolved => {
        const current = ctx._currentBoundaryId;
        ctx._currentBoundaryId = boundary;
        try {
          apply(resolved);
        } finally {
          ctx._currentBoundaryId = current;
        }
      },
      // Hint only — a failed resolution already warns at the manifest seam.
      () => {}
    );
  } else {
    apply(assets as Awaited<ReturnType<typeof resolve>>);
  }
}

/**
 * Server half of `clientOnly`: the wrapped component never renders on the
 * server — the import is never even started — only `props.fallback` is
 * SSR'd. The client build swaps the real component in after load + mount.
 * See the client entry's JSDoc for the full contract.
 *
 * `moduleUrl` is injected by the bundler's module-URL pass (the same one
 * that annotates `lazy()`, padding the options slot when a call site omits
 * it); when present and an asset manifest is set, the render emits early
 * preload hints for the module — see `registerClientOnlyPreload` for why
 * they stay out of the hydration asset map. Without it (untransformed code)
 * or without a manifest, behavior is unchanged.
 */
export function clientOnly<M extends Record<string, any>, K extends keyof M & string>(
  fn: () => Promise<M>,
  options: { lazy?: boolean; export: K },
  moduleUrl?: string
): Component<ComponentProps<M[K]> & { fallback?: JSX.Element }>;
export function clientOnly<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  options?: { lazy?: boolean; export?: string },
  moduleUrl?: string
): Component<ComponentProps<T> & { fallback?: JSX.Element }>;
export function clientOnly<T extends Component<any>>(
  _fn: () => Promise<any>,
  _options: { lazy?: boolean; export?: string } = {},
  moduleUrl?: string
): Component<ComponentProps<T> & { fallback?: JSX.Element }> {
  return props => {
    if (moduleUrl) registerClientOnlyPreload(moduleUrl);
    // The memo is not caching anything — it mirrors the client half's gate
    // memo so the fallback's elements derive their hydration ids at the same
    // owner depth on both sides and the client claims them instead of
    // duplicating (the same id-alignment trick as lazy(), see
    // solid/src/server/component.ts).
    return createMemo(() => props.fallback as JSX.Element) as unknown as JSX.Element;
  };
}

// --- Declaration ledgers -------------------------------------------------
//
// httpStatus/httpHeader retraction must remove exactly one scope's
// declaration, no matter what order scopes dispose in. A write-time
// snapshot restore is only correct for LIFO disposal; with independently
// recovering sibling SSR scopes an EARLIER writer can dispose while a later
// one stays live, and restoring the earlier snapshot would delete the
// survivor's contribution (silently dropping e.g. a session cookie, #2984).
// So each response head keeps a ledger per field: the base (what was there
// before the first declaration — the integration's own writes) plus the
// ordered list of live declarations. Retraction removes one declaration and
// replays the survivors over the base. When the last declaration retracts,
// the ledger entry is dropped so a future declaration re-reads a fresh base.

type StatusEntry = { status: number | undefined; statusText: string | undefined };
type StatusLedger = { base: StatusEntry; live: StatusEntry[] };
const statusLedgers = /* @__PURE__ */ new WeakMap<ResponseStub, StatusLedger>();

type HeaderDeclaration = { value: string; append: boolean };
type HeaderLedger = { base: string | string[] | null; live: HeaderDeclaration[] };
const headerLedgers = /* @__PURE__ */ new WeakMap<ResponseStub, Map<string, HeaderLedger>>();

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
 * Retraction semantics: disposal retracts only this scope's declaration —
 * the response falls back to the latest still-live declaration, or to the
 * base status the integration had set before the first declaration. A
 * boundary that errored, declared a status, and then recovered retracts its
 * write without stomping a status a surviving part of the tree legitimately
 * set (e.g. a 404 page whose inner boundary recovers stays a 404), and
 * sibling scopes may dispose in any order (#2984). Both the write and the
 * cleanup are no-ops once the integration marks the response head
 * `committed` (head derived/sent — status can no longer change). On the
 * client this is a no-op.
 */
export function httpStatus(code: number, text?: string): void {
  // `response` is an integration-augmented field (see core's ResponseStub);
  // read it structurally so the primitives work against the bare contract.
  const event = getRequestEvent() as (RequestEvent & { response?: ResponseStub }) | undefined;
  const response = event && event.response;
  if (response && !response.committed) {
    let ledger = statusLedgers.get(response);
    if (!ledger) {
      ledger = { base: { status: response.status, statusText: response.statusText }, live: [] };
      statusLedgers.set(response, ledger);
    }
    const declaration: StatusEntry = { status: code, statusText: text };
    ledger.live.push(declaration);
    response.status = code;
    response.statusText = text;
    onCleanup(() => {
      if (response.committed) return;
      const index = ledger.live.indexOf(declaration);
      if (index < 0) return;
      ledger.live.splice(index, 1);
      const effective = ledger.live.length ? ledger.live[ledger.live.length - 1] : ledger.base;
      response.status = effective.status as number;
      response.statusText = effective.statusText;
      if (!ledger.live.length) statusLedgers.delete(response);
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
 * Retraction semantics: disposal retracts only this scope's declaration —
 * the header is recomputed by replaying the still-live declarations, in
 * their original write order, over the base value the integration had set
 * before the first declaration (deleted when there is neither). Sibling
 * scopes may therefore dispose in any order without disturbing each
 * other's contributions (#2984). For `set-cookie` — the one header whose
 * multiple values must survive as separate entries — the base is captured
 * and replayed entry-exact (`getSetCookie()` + re-append; `get()`/`set()`
 * would comma-join the entries and then collapse them into one corrupt
 * header). Both the write and the cleanup are no-ops once the integration
 * marks the response head `committed` (head derived/sent — headers can no
 * longer change). On the client this is a no-op.
 */
export function httpHeader(name: string, value: string, options?: { append?: boolean }): void {
  const event = getRequestEvent() as (RequestEvent & { response?: ResponseStub }) | undefined;
  const response = event && event.response;
  if (response && !response.committed) {
    const headers = response.headers;
    const key = name.toLowerCase();
    const setCookie = key === "set-cookie";
    let ledgers = headerLedgers.get(response);
    if (!ledgers) headerLedgers.set(response, (ledgers = new Map()));
    let ledger = ledgers.get(key);
    if (!ledger) {
      // Entry-exact base for set-cookie: `get()` comma-joins multiple
      // entries, and replaying that join through `set()` would collapse
      // them into one corrupt header (commas are legal inside a single
      // cookie's `Expires`), so capture the entry list instead.
      ledger = { base: setCookie ? headers.getSetCookie() : headers.get(name), live: [] };
      ledgers.set(key, ledger);
    }
    const declaration: HeaderDeclaration = { value, append: !!(options && options.append) };
    ledger.live.push(declaration);
    if (declaration.append) headers.append(name, value);
    else headers.set(name, value);
    onCleanup(() => {
      if (response.committed) return;
      const index = ledger.live.indexOf(declaration);
      if (index < 0) return;
      ledger.live.splice(index, 1);
      // Replay the survivors over the base — the exact sequence of writes
      // that would have happened had the retracted scope never run.
      headers.delete(name);
      if (setCookie) {
        for (const cookie of ledger.base as string[]) headers.append(name, cookie);
      } else if (ledger.base !== null) {
        headers.set(name, ledger.base as string);
      }
      for (const d of ledger.live) {
        if (d.append) headers.append(name, d.value);
        else headers.set(name, d.value);
      }
      if (!ledger.live.length) ledgers.delete(key);
    });
  }
}
