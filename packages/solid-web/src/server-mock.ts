//@ts-nocheck
import type { ResponseStub } from "./client.js";

function throwInBrowser(func: Function) {
  const err = new Error(`${func.name} is not supported in the browser, returning undefined`);

  console.error(err);
}

/**
 * Renders a component tree synchronously to an HTML string. Async reads inside
 * `<Loading>` boundaries emit their `fallback` content; for full-graph
 * resolution use `renderToStringAsync` instead.
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
    manifest?: Record<
      string,
      {
        file: string;
        css?: string[];
        isEntry?: boolean;
        isDynamicEntry?: boolean;
        imports?: string[];
      }
    >;
    onError?: (err: any) => void;
  }
): string {
  throwInBrowser(renderToString);
}
/**
 * Renders a component tree to an HTML string and awaits all async reads in the
 * subtree before resolving. The returned HTML reflects the fully-settled state
 * — no `<Loading>` fallbacks appear in the output.
 *
 * Use this when you want a complete page in one round-trip. For incremental
 * streaming with progressive boundary resolution, use `renderToStream`.
 *
 * @example
 * ```tsx
 * import { renderToStringAsync } from "@solidjs/web";
 *
 * const html = await renderToStringAsync(() => <App />);
 * ```
 */
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    timeoutMs?: number;
    nonce?: string;
    renderId?: string;
    noScripts?: boolean;
    plugins?: any[];
    manifest?: Record<
      string,
      {
        file: string;
        css?: string[];
        isEntry?: boolean;
        isDynamicEntry?: boolean;
        imports?: string[];
      }
    >;
    onError?: (err: any) => void;
  }
): Promise<string> {
  throwInBrowser(renderToStringAsync);
}
/**
 * Streams an HTML response, flushing the synchronous shell first and then
 * progressively emitting async-resolved fragments as their `<Loading>`
 * boundaries settle. Good for time-to-first-byte sensitive pages.
 *
 * Returns an object with `pipe`/`pipeTo` for piping to a Node `Writable` or
 * a Web `WritableStream`, a lazy `readable` byte-stream view for
 * `new Response(stream.readable)`, plus a `then` for awaiting full
 * completion. `pipe`, `pipeTo`, and `readable` each consume the render —
 * use exactly one of the three.
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
 * ```
 */
export function renderToStream<T>(
  fn: () => T,
  options?: {
    nonce?: string;
    renderId?: string;
    noScripts?: boolean;
    plugins?: any[];
    manifest?: Record<
      string,
      {
        file: string;
        css?: string[];
        isEntry?: boolean;
        isDynamicEntry?: boolean;
        imports?: string[];
      }
    >;
    onCompleteShell?: (info: { write: (v: string) => void }) => void;
    onCompleteAll?: (info: { write: (v: string) => void }) => void;
    onError?: (err: any) => void;
  }
): {
  then: (fn: (html: string) => void) => void;
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
export function createRequestEvent(
  request: Request,
  init?: { locals?: Record<string, unknown>; response?: ResponseStub } & Record<string, unknown>
): { request: Request; locals: Record<string, unknown>; response: ResponseStub } {
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
  result: string | { pipe: (writable: { write: (v: string) => void; end: () => void }) => void },
  event: { response?: ResponseStub },
  options?: {
    responseInit?: ResponseInit;
    nonce?: string;
    transformChunk?: (chunk: string) => string;
  }
): Response | Promise<Response> {
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
): (request: Request, next: (request?: Request) => Promise<Response>) => Promise<Response> {
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
 * Compiler primitive — serializes a classList object for SSR output. Not
 * meant for hand-written code.
 * @internal
 */
export function ssrClassList(value: { [k: string]: boolean }): string {}
/**
 * Compiler primitive — serializes a style object for SSR output. Not meant
 * for hand-written code.
 * @internal
 */
export function ssrStyle(value: { [k: string]: string }): string {}
/**
 * Compiler primitive — serializes a boolean attribute for SSR output. Not
 * meant for hand-written code.
 * @internal
 */
export function ssrAttribute(key: string, value: boolean): string {}
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
export function resolveSSRNode(node: any): string {}
/**
 * Escapes a string for safe inclusion in HTML output. Used by the SSR
 * runtime; not generally part of user code.
 * @internal
 */
export function escape(html: string): string {}
