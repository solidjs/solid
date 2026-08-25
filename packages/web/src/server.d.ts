import { JSX } from "./jsx.js";
import { SerializerPlugin } from "./serializer-decode.js";
export const DOMWithState: Record<string, Record<string, 1 | 2>>;
export const ChildProperties: Set<string>;
export const DelegatedEvents: Set<string>;
export const DOMElements: Set<string>;
export const SVGElements: Set<string>;
export const MathMLElements: Set<string>;
export const VoidElements: Set<string>;
export const RawTextElements: Set<string>;
export const Namespaces: Record<string, string>;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

/** Static asset manifest produced by a build (e.g. parsed Vite manifest.json). */
export type AssetManifest = Record<
  string,
  { file: string; css?: string[]; isEntry?: boolean; imports?: string[] }
> & { _base?: string };

/** Inline style content, e.g. dev CSS collected from a bundler's module graph. */
export type InlineStyleAsset = {
  id: string;
  content: string;
  attrs?: Record<string, string>;
};

export type ResolvedAssets = {
  js: string[];
  css: (string | InlineStyleAsset)[];
};

/**
 * Resolver form of the manifest option — the primitive a dev server
 * implements against its live module graph (a static manifest object is
 * normalized into a sync resolver internally). `resolve` may return a
 * promise (async resolvers require streaming rendering); CSS entries may be
 * URL strings (emitted as load-gated `<link>` tags) or inline-style
 * descriptors (emitted as `<style>` tags). A bare `resolve`-shaped function
 * is accepted as shorthand for `{ resolve }`.
 */
export type AssetResolver = {
  resolve(
    key: string
  ): ResolvedAssets | null | undefined | Promise<ResolvedAssets | null | undefined>;
  /**
   * Synchronous fast path answering with whatever is knowable without async
   * work (typically js URLs, omitting css). Sync consumers — e.g. a lazy
   * component's `moduleUrl` getter used by islands — use this when `resolve`
   * would return a promise, so adapters should provide it whenever possible.
   */
  resolveSync?(key: string): ResolvedAssets | null | undefined;
};

/** Bare-function shorthand for `AssetResolver` (no sync fast path). */
export type AssetResolverFn = (
  key: string
) => ResolvedAssets | null | undefined | Promise<ResolvedAssets | null | undefined>;

/**
 * CSP nonce for the tags a server render emits. A string applies to both
 * nonce-aware destinations. A `{ script, style }` pair routes each tag to
 * the directive governing its fetch (`script-src-elem` / `style-src-elem`,
 * falling back to `script-src` / `style-src` then `default-src`). Both
 * keys are required; `false` leaves that destination un-nonced. Worker
 * destinations take the script nonce, which only applies when their own
 * fallback reaches `script-src`. A nonce on a `useHead` tag's own props
 * always wins.
 *
 * Only `renderToString` / `renderToStream` take this shape. Surfaces that
 * emit one script (`HydrationScript`, `generateHydrationScript`,
 * `createSSRResponse`) take a string — project with `scriptNonce`.
 */
export type CSPNonce = string | { script: string | false; style: string | false };

/** The script-destination half of a render `nonce`. */
export function scriptNonce(nonce?: CSPNonce): string | undefined;
/** The style-destination half of a render `nonce`. */
export function styleNonce(nonce?: CSPNonce): string | undefined;

export function renderToString<T>(
  fn: () => T,
  options?: {
    nonce?: CSPNonce;
    renderId?: string;
    noScripts?: boolean;
    plugins?: SerializerPlugin[];
    manifest?: AssetManifest | AssetResolver | AssetResolverFn;
    onError?: (err: any) => void;
    /**
     * Embedded-render contract for hosts that own the document. When the
     * render output contains no `</head>`, everything head-bound (resolved
     * `useHead` winners, eager resources, tracked asset links, inline
     * styles) is delivered here as one HTML string — prelude (charset/base)
     * first — for the host to splice into its own `<head>` template, instead
     * of being dropped. Called synchronously before `renderToString`
     * returns; not called when the output has a `</head>` (splicing is
     * automatic then).
     */
    onHead?: (head: string) => void;
  }
): string;
export function renderToStream<T>(
  fn: () => T,
  options?: {
    nonce?: CSPNonce;
    renderId?: string;
    noScripts?: boolean;
    plugins?: SerializerPlugin[];
    manifest?: AssetManifest | AssetResolver | AssetResolverFn;
    onCompleteShell?: (info: { write: (v: string) => void }) => void;
    onCompleteAll?: (info: { write: (v: string) => void }) => void;
    onError?: (err: any) => void;
    /**
     * Embedded-render contract for hosts that own the document. When the
     * shell contains no `</head>`, everything head-bound at first flush
     * (resolved `useHead` winners, eager resources, tracked asset links,
     * inline styles) is delivered here as one HTML string — prelude first —
     * before the shell chunk is emitted, so the host can write its own
     * `<head>` ahead of piping the stream. Post-shell head updates flow
     * through the stream itself and apply in the browser. Not called when
     * the shell has a `</head>` (splicing is automatic then).
     */
    onHead?: (head: string) => void;
  }
): {
  /**
   * Awaiting the stream resolves with the complete HTML once every boundary
   * settles — the fully-settled-string form of the render (`const html =
   * await renderToStream(...)`). Render errors route through `onError` and
   * the promise resolves with whatever HTML the render produced; it never
   * rejects.
   */
  then<TResult1 = string, TResult2 = never>(
    onfulfilled?: ((html: string) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  pipe: (writable: { write: (v: string) => void; end: () => void }) => void;
  pipeTo: (writable: WritableStream) => Promise<void>;
  /**
   * Lazy `ReadableStream<Uint8Array>` view of the render — hand it straight
   * to `new Response(stream.readable)`. First access starts the render
   * piping through an internal `TransformStream` (chunks are UTF-8 encoded
   * bytes, the same as `pipeTo` writes) and the stream is cached, so
   * repeated access returns the same instance. Like `pipe`/`pipeTo`, this
   * consumes the render: use exactly one of the three — mixing distinct
   * consumers (`readable` after `pipe`/`pipeTo`, or vice versa) throws an
   * error naming the conflict.
   */
  readonly readable: ReadableStream<Uint8Array>;
};

export function HydrationScript(props: { nonce?: string; eventNames?: string[] }): JSX.Element;
export function ssr(template: string[] | string, ...nodes: any[]): { t: string };
export function ssrElement(
  name: string,
  props: any,
  children: any,
  needsId: boolean
): { t: string };
export function ssrClassName(value: string | { [k: string]: boolean } | Array<any>): string;
export function ssrStyle(value: string | { [k: string]: string }): string;
export function ssrStyleProperty(name: string, value: any): string;
export function ssrAttribute(key: string, value: any): string;
export function ssrGroup<T extends () => any[]>(fn: T, n: number): T;
export function scope<T>(fn: () => T): () => unknown;
export function ssrHydrationKey(): string;
export function resolveSSRNode(node: any, result?: any, top?: boolean): any;
export function escape(s: any, attr?: boolean): any;
export function applyRef(
  r: ((element: any) => void) | ((element: any) => void)[],
  element: any
): void;
/**
 * A head tag descriptor. Props values may be getters (evaluated lazily on
 * the server — at the owning flush boundary — and reactively on the client);
 * `children` is the text body (title text, inline style/script content).
 * `key` overrides the built-in dedupe identity (`title` is a hard singleton
 * that `key` cannot fork).
 *
 * Getters must be plain reads: they evaluate at flush time here (under no
 * component owner) and inside registry-owned computations on the client, so
 * a getter that allocates a reactive owner (`createMemo`, a `children()`
 * helper) consumes a hydration id slot on one side only and desyncs every
 * id allocated after the `useHead` call. Create such helpers eagerly at
 * component position and read them from the getter. See
 * docs/head-management-rfc.md.
 */
export type HeadTag = {
  tag: "title" | "meta" | "link" | "style" | "script" | "base";
  props: Record<string, any>;
  key?: string | (() => string);
};
/**
 * Registers head tags with the render's head registry. An array is a group —
 * one replacement set; a single tag is a group of one; a function is a
 * reactive group whose membership resolves at the owning flush boundary
 * (resource tags inside it emit at that flush rather than eagerly).
 * Replaceable tags (title/meta/canonical/…) resolve by last-committed group
 * and stream as patches with their suspense boundary's reveal; resource tags
 * (preload and friends, stylesheets, `script[src]`) emit eagerly and dedupe
 * by identity. See docs/head-management-rfc.md.
 */
export function useHead(tag: HeadTag | HeadTag[] | (() => HeadTag | HeadTag[])): void;
export function getHydrationKey(): string | undefined;
export function effect<T>(fn: (prev?: T) => T, effect: (value: T, prev?: T) => void): void;
export function memo<T>(fn: () => T, equal: boolean): () => T;
export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element;
export function mergeProps(...sources: unknown[]): unknown;
export function getOwner(): unknown;
export function generateHydrationScript(options?: {
  nonce?: string;
  eventNames?: string[];
}): string;
/**
 * Registered symbol (`Symbol.for("solid.RequestContext")`) naming the
 * global slot where `provideRequestEvent` parks the AsyncLocalStorage that
 * scopes request events. Integration plumbing — application code reads the
 * event through `getRequestEvent()` instead.
 * @internal
 */
export declare const RequestContext: unique symbol;
/**
 * The mutable response head an integration's handler exposes on the request
 * event as `event.response`: status/statusText/headers it will apply when
 * sending the response. A scaffold, not a `Response` — application code
 * (e.g. JSX response components) writes to it during render, and the
 * handler reads it when the head goes out. Core does not declare the
 * `response` property on `RequestEvent` itself: integrations that provide
 * one declare it through module augmentation (as `@solidjs/router` does),
 * and this type names the shape they agree on. Core's server-function
 * handler folds it onto the outgoing response when present — its
 * `Set-Cookie` values (cookies appended during the call via
 * `serializeCookie`) append cookie-by-cookie, other headers fill gaps —
 * and reads it when folding single-flight cookies, but never requires it.
 */
export interface ResponseStub {
  status?: number;
  statusText?: string;
  headers: Headers;
  /**
   * Set once the response head has been derived/sent from this stub —
   * status and headers can no longer change. Flip it through
   * `commitResponseStub`, which also instruments the stub's `headers` so
   * a post-commit write fails loudly (dev build throws, production
   * reports + no-ops) instead of silently missing the wire. `status`/
   * `statusText` stay plain fields: consumers that write response
   * metadata during render (e.g. JSX response components) must still
   * treat later status writes and cleanup-time retractions as no-ops.
   */
  committed?: boolean;
}

/**
 * The type of `RequestEvent.locals` — a module-augmentable interface so
 * applications can type the state their middleware hangs on the event.
 * Augment it through the package that re-exports the event (interface
 * identity flows through the re-export chain):
 *
 * ```ts
 * declare module "@solidjs/web" {
 *   interface RequestEventLocals {
 *     user: User;
 *   }
 * }
 * ```
 *
 * The index signature keeps un-augmented usage permissive — `locals` is a
 * free-form bag by default — so augmentation adds precision for the keys
 * it names without gating existing code. The flip side: unaugmented keys
 * read as `any` rather than erroring, a deliberate trade (a strict-only
 * `locals` would break every untyped write that works today).
 */
export interface RequestEventLocals {
  [key: string | number | symbol]: any;
}

/**
 * The per-request context available on the server: the incoming `Request`
 * and a `locals` bag integrations and middleware can hang state on (typed
 * through the augmentable `RequestEventLocals`). Frameworks typically
 * extend this shape with richer fields (e.g. a `response` head — see
 * `ResponseStub`).
 */
export interface RequestEvent {
  request: Request;
  locals: RequestEventLocals;
}
/**
 * The current request event, when called on the server inside a request
 * scope (established by `provideRequestEvent` from `@solidjs/web/storage`
 * or by the framework). Undefined on the client and outside a request.
 * Read it above `await` boundaries in partially-polyfilled environments.
 */
export function getRequestEvent(): RequestEvent | undefined;

/** A fresh, uncommitted response head. */
export function createResponseStub(): ResponseStub;

/**
 * The canonical request event for HTTP handlers: the incoming `Request`, a
 * `locals` bag, and a `response` head stub the render writes to. `init`
 * spreads over the defaults so frameworks can extend the shape.
 */
export function createRequestEvent<T extends object = {}>(
  request: Request,
  init?: T
): RequestEvent & { response: ResponseStub } & T;

/**
 * The status an outgoing redirect should use for a response head carrying
 * a `Location`: the stub's own status when it is a redirect status, 302
 * otherwise.
 */
export function getExpectedRedirectStatus(response: ResponseStub): number;

/**
 * Flips a response stub to `committed` — the moment its head freezes on
 * the wire — and instruments the stub's `headers` mutating methods
 * (`set`/`append`/`delete`, patched in place; the `Headers` identity and
 * reads are untouched) so a post-commit write fails loudly instead of
 * silently missing the wire: it throws in the dev build and reports +
 * no-ops otherwise. Every head materialization path commits through here
 * (`createSSRResponse`, the server-function handler's commit seam);
 * integrations deriving their own heads should too.
 *
 * `allowLateLocation` is the stream path's documented exception: a
 * `Location` set after the shell flushed is still honored client-side
 * (stream completion appends a `window.location` script), so that one
 * write stays permitted there.
 */
export function commitResponseStub(
  stub: ResponseStub,
  options?: { allowLateLocation?: boolean }
): ResponseStub;

/**
 * Handler-lifecycle plumbing — a response's exit through the request
 * event's response-stub lifecycle: page results leave through
 * `createSSRResponse`, any other `Response` (a middleware early return, an
 * API result) leaves through `commitEventResponse`; application middleware
 * never calls this. Folds the event's stub onto the outgoing response —
 * `Set-Cookie` appends entry-by-entry alongside the response's own, other
 * stub headers fill gaps only (never the wire-protocol family the handlers
 * own, never `Content-Type`/`Content-Length` on a bodiless response), the
 * status is never taken from the stub — then commits the stub
 * (`commitResponseStub`: post-commit writes fail loudly). Responses with
 * immutable headers are rebuilt around merged copies.
 *
 * Idempotent at handler edges: an already-committed stub passes the
 * response through untouched, so a handler may apply this unconditionally
 * after its middleware chain unwinds — page responses from
 * `createSSRResponse` come back committed and do not double-fold.
 *
 * `event` defaults to the ambient `getRequestEvent()`.
 */
export function commitEventResponse(response: Response, event?: RequestEvent): Response;

/**
 * The cookie codec (the platform-gap primitives — see cookies.d.ts): ALL
 * of core's cookie surface. The blessed patterns are
 * `parseCookieHeader(event.request.headers.get("cookie"))` for reads and
 * `event.response.headers.append("set-cookie", serializeCookie(name,
 * value, options))` for writes.
 */
export { parseCookieHeader, serializeCookie } from "./cookies.js";
export type { CookieOptions } from "./cookies.js";

/**
 * The flash cookie's isomorphic half and the codec-free server-function
 * layer (reference detection + the late-bound RPC seam) — mirrors of the
 * client entry's exports, so integration code reading them stays
 * universal. Declared through server-functions/shared.d.ts, the
 * declaration home published-types layouts ship.
 */
export {
  clearFlashCookie,
  getServerFunctionMetadata,
  getServerFunctionRPC,
  hasFlashCookie,
  isServerFunction
} from "./server-functions/shared.js";
export type {
  ServerFunction,
  ServerFunctionMetadata,
  ServerFunctionRPC
} from "./server-functions/shared.js";

export interface SSRResponseOptions {
  /** Base head; the stub's status/headers win over it. */
  responseInit?: ResponseInit;
  /** Nonce carried by the post-flush `<script>` redirect fallback. */
  nonce?: string;
  /** Rewrites each outgoing HTML chunk (entry script injection, ...). */
  transformChunk?: (chunk: string) => string;
}

/**
 * Derives the outgoing `Response` for an SSR render result, running the
 * response-head lifecycle against `event.response`: commit at shell flush,
 * pre-flush `Location` becomes a real redirect, post-flush `Location`
 * appends a client-side script redirect before the stream closes.
 * Synchronous for string results; resolves at shell flush for stream
 * results.
 */
export function createSSRResponse(
  result: string,
  event: RequestEvent | undefined,
  options?: SSRResponseOptions
): Response;
export function createSSRResponse(
  result: { pipe(writable: { write: (v: string) => void; end: () => void }): void },
  event: RequestEvent | undefined,
  options?: SSRResponseOptions
): Promise<Response>;

/**
 * Fetch-style middleware: return a `Response` to answer the request, or
 * call `next()` (optionally with a substitute `Request`) to advance the
 * chain and observe/replace the eventual response.
 */
export type FetchMiddleware = (
  request: Request,
  next: (request?: Request) => Promise<Response>
) => Response | Promise<Response>;

/**
 * Composes fetch-style middleware into one function of the same shape;
 * the terminal `next` dispatches to the actual handler. Runs in whatever
 * scope the caller established (`provideRequestEvent`), so
 * `getRequestEvent()` works exactly as in application code.
 */
export function composeMiddleware(
  middlewares: FetchMiddleware[]
): (
  request: Request,
  next: (request?: Request) => Response | Promise<Response>
) => Promise<Response>;

export function untrack<T>(fn: () => T): T;

// client-only APIs

/** @deprecated not supported on the server side */
export function style(
  node: Element,
  value: { [k: string]: string },
  prev?: { [k: string]: string }
): void;

/** @deprecated not supported on the server side */
export function insert<T>(
  parent: MountableElement,
  accessor: (() => T) | T,
  marker?: Node | null,
  init?: JSX.Element
): JSX.Element;

/** @deprecated not supported on the server side */
export function spread<T>(node: Element, accessor: T, skipChildren?: Boolean): void;

/** @deprecated not supported on the server side */
export function delegateEvents(eventNames: string[]): void;
/** @deprecated not supported on the server side */
export function registerDelegatedRoot(root: MountableElement): void;
/** @deprecated not supported on the server side */
export function unregisterDelegatedRoot(root: MountableElement): void;
/** @deprecated not supported on the server side */
export function registerDelegatedContainer(
  container: MountableElement,
  owner?: MountableElement
): void;
/** @deprecated not supported on the server side */
export function unregisterDelegatedContainer(
  container: MountableElement,
  owner?: MountableElement
): void;
/** @deprecated not supported on the server side */
export function getDelegatedRoot(node: MountableElement): MountableElement | undefined;
/** @deprecated not supported on the server side */
export function dynamicProperty(props: unknown, key: string): unknown;
/** @deprecated not supported on the server side */
export function setAttribute(node: Element, name: string, value: string): void;
/** @deprecated not supported on the server side */
export function setAttributeNS(node: Element, namespace: string, name: string, value: string): void;

/**
 * Server no-op: element claims are a client-only concern, but consumers may
 * register isomorphically. Returns a no-op unregister function.
 */
export function registerElementClaim(handler: (element: Element) => void): () => void;
/** Server no-op: returns `node` unchanged. Claims never fire during SSR. */
export function claimElement<T extends Element>(node: T): T;
/** Server no-op: returns `root` unchanged. Claims never fire during SSR. */
export function claimElementTree<T extends Node>(root: T): T;

/** @deprecated not supported on the server side */
export function addEvent(node: Element, name: string, handler: () => void, delegate: boolean): void;

/** @deprecated not supported on the server side */
export function render(code: () => JSX.Element, element: MountableElement): () => void;
/**
 * @deprecated not supported on the server side
 * @param flag
 * - `undefined` — clone the template as-is (uses `cloneNode`).
 * - `1` — use `document.importNode` instead of `cloneNode`.
 * - `2` — the template html is wrapped; the outer tag is stripped at clone time.
 */
export function template(html: string, flag?: 1 | 2): () => Element;
/** @deprecated not supported on the server side */
export function setProperty(node: Element, name: string, value: any): void;
/** @deprecated not supported on the server side */
export function className(node: Element, value: string): void;
/** @deprecated not supported on the server side */
export function assign(node: Element, props: any, skipChildren?: Boolean): void;

/** @deprecated not supported on the server side */
export function hydrate(
  fn: () => JSX.Element,
  node: MountableElement,
  options?: { renderId?: string; owner?: unknown }
): () => void;

/** @deprecated not supported on the server side */
export function getNextElement(template?: () => Element): Element;
/** @deprecated not supported on the server side */
export function getNextMatch(start: Node, elementName: string): Element;
/** @deprecated not supported on the server side */
export function getNextMarker(start: Node): [Node, Array<Node>];
/** @deprecated not supported on the server side */
export function runHydrationEvents(): void;
/** @deprecated not supported on the server side */
export function ref(
  fn: () => ((element: Element) => void) | ((element: Element) => void)[],
  element: Element
): void;
/** @deprecated not supported on the server side */
export function setStyleProperty(node: Element, name: string, value: any): void;
/**
 * @internal See client.d.ts — head-management RFC policy: ambient CSS is
 * unmanaged; the head registry owns directly-mounted stylesheet lifecycle.
 * @deprecated not supported on the server side — register assets through the render context instead
 */
export function acquireAsset(descriptor: unknown): () => void;
