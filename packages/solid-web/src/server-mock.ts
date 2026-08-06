//@ts-nocheck
import type { RequestEvent, ResponseStub } from "./client.js";

function throwInBrowser(func: Function) {
  const err = new Error(`${func.name} is not supported in the browser, returning undefined`);

  console.error(err);
}

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
 * Renders a component tree synchronously to an HTML string. Async reads inside
 * `<Loading>` boundaries emit their `fallback` content; for full-graph
 * resolution await `renderToStream` instead.
 *
 * Pair the returned HTML with `hydrate()` on the client.
 *
 * @example
 * ```tsx
 * import { renderToString } from "@solidjs/web";
 *
 * const html = renderToString(() => <App />);
 * res.send(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
 * ```
 */
export function renderToString<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    renderId?: string;
    noScripts?: boolean;
    plugins?: any[];
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
): string {
  throwInBrowser(renderToString);
}
/**
 * Streams an HTML response, flushing the synchronous shell first and then
 * progressively emitting async-resolved fragments as their `<Loading>`
 * boundaries settle. Good for time-to-first-byte sensitive pages.
 *
 * Returns an object with `pipe`/`pipeTo` for piping to a Node `Writable` or
 * a Web `WritableStream`, a lazy `readable` byte-stream view for
 * `new Response(stream.readable)`, plus a thenable for awaiting full
 * completion — `await renderToStream(...)` resolves with the settled HTML
 * (the fully-resolved-string form of the render). `pipe`, `pipeTo`, and
 * `readable` each consume the render — use exactly one of the three.
 *
 * @example
 * ```tsx
 * import { renderToStream } from "@solidjs/web";
 *
 * // Node:
 * renderToStream(() => <App />).pipe(res);
 *
 * // Web (Workers / Deno):
 * return new Response(renderToStream(() => <App />).readable);
 *
 * // Fully settled string:
 * const html = await renderToStream(() => <App />);
 * ```
 */
export function renderToStream<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    renderId?: string;
    noScripts?: boolean;
    plugins?: any[];
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
   * settles — the fully-settled-string form of the render. Render errors
   * route through `onError` and the promise resolves with whatever HTML the
   * render produced; it never rejects.
   */
  then<TResult1 = string, TResult2 = never>(
    onfulfilled?: ((html: string) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  pipe: (writable: { write: (v: string) => void; end: () => void }) => void;
  pipeTo: (writable: WritableStream) => Promise<void>;
  readonly readable: ReadableStream<Uint8Array>;
} {
  throwInBrowser(renderToStream);
}
/**
 * Fetch-style middleware: receives the `Request` and a `next` continuation
 * (pass a `Request` to substitute it downstream) and returns the `Response`.
 * Composed with `composeMiddleware`; runs inside the request-event scope, so
 * `getRequestEvent()` works exactly as in application code.
 */
export type FetchMiddleware = (
  request: Request,
  next: (request?: Request) => Promise<Response>
) => Response | Promise<Response>;

/**
 * Creates a fresh, uncommitted {@link ResponseStub}. Server-only.
 */
export function createResponseStub(): ResponseStub {
  throwInBrowser(createResponseStub);
}

/**
 * Builds the canonical request event — a web-standard `Request`, a `locals`
 * bag, and a stub-backed `response` head — for `provideRequestEvent`.
 * Server-only: on the client the request event belongs to the server that
 * rendered the page.
 */
export function createRequestEvent<T extends object = {}>(
  request: Request,
  init?: T
): { request: Request; locals: Record<string | number | symbol, any>; response: ResponseStub } & T {
  throwInBrowser(createRequestEvent);
}

/**
 * The HTTP status a redirect should use: the stub's own status when it is a
 * redirect status (301/302/303/307/308), 302 otherwise. Server-only.
 */
export function getExpectedRedirectStatus(response: ResponseStub): number {
  throwInBrowser(getExpectedRedirectStatus);
}

/**
 * Derives the outgoing `Response` for an SSR render result, running the
 * response-head lifecycle against `event.response`: the stub commits at
 * shell flush, a pre-flush `Location` becomes a real redirect
 * (`getExpectedRedirectStatus`), and a post-flush one appends the
 * nonce-aware `<script>window.location=...</script>` fallback. String
 * results return a `Response` synchronously; stream results resolve at
 * shell flush. Server-only.
 */
export function createSSRResponse(
  result: string,
  event: RequestEvent | undefined,
  options?: {
    responseInit?: ResponseInit;
    nonce?: string;
    transformChunk?: (chunk: string) => string;
  }
): Response;
export function createSSRResponse(
  result: { pipe(writable: { write: (v: string) => void; end: () => void }): void },
  event: RequestEvent | undefined,
  options?: {
    responseInit?: ResponseInit;
    nonce?: string;
    transformChunk?: (chunk: string) => string;
  }
): Promise<Response>;
export function createSSRResponse(): Response | Promise<Response> {
  throwInBrowser(createSSRResponse);
}

/**
 * Composes fetch-style middleware — `(request, next) => Response` — into a
 * single function of the same shape. Nothing reaches the wire until the
 * outermost middleware returns, so headers on the returned `Response` stay
 * mutable through the whole unwind, streamed bodies included. Server-only.
 */
export function composeMiddleware(
  middlewares: FetchMiddleware[]
): (
  request: Request,
  next: (request?: Request) => Response | Promise<Response>
) => Promise<Response> {
  throwInBrowser(composeMiddleware);
}

/**
 * Compiler primitive — emitted by JSX-DOM-Expressions for tagged-template
 * SSR output. Not meant for hand-written code.
 * @internal
 */
export function ssr(template: string[] | string, ...nodes: any[]): { t: string } {}
/**
 * Compiler primitive — emitted by JSX-DOM-Expressions for SSR element
 * output. Not meant for hand-written code.
 * @internal
 */
export function ssrElement(
  name: string,
  props: any,
  children: any,
  needsId: boolean
): { t: string } {}
/**
 * Compiler primitive — serializes a class value (string, object map, or
 * array) for SSR output. Not meant for hand-written code.
 * @internal
 */
export function ssrClassName(value: string | { [k: string]: boolean } | Array<any>): string {}
/**
 * Compiler primitive — serializes a style value for SSR output. Not meant
 * for hand-written code.
 * @internal
 */
export function ssrStyle(value: string | { [k: string]: string }): string {}
/**
 * Compiler primitive — serializes one style property for SSR output. Not
 * meant for hand-written code.
 * @internal
 */
export function ssrStyleProperty(name: string, value: any): string {}
/**
 * Compiler primitive — serializes an attribute for SSR output. Not meant
 * for hand-written code.
 * @internal
 */
export function ssrAttribute(key: string, value: any): string {}
/**
 * Compiler primitive — wraps a template-group closure for SSR output. Not
 * meant for hand-written code.
 * @internal
 */
export function ssrGroup<T extends () => any[]>(fn: T, n: number): T {}
/**
 * Compiler primitive — generates the hydration-key attribute for SSR
 * output. Not meant for hand-written code.
 * @internal
 */
export function ssrHydrationKey(): string {}
/**
 * Compiler primitive — collapses an SSR-shaped node into its HTML string.
 * Not meant for hand-written code.
 * @internal
 */
export function resolveSSRNode(node: any, result?: any, top?: boolean): any {}
/**
 * Escapes a string for safe inclusion in HTML output. Used by the SSR
 * runtime; not generally part of user code.
 * @internal
 */
export function escape(s: any, attr?: boolean): any {}
