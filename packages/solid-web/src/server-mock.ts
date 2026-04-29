//@ts-nocheck
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
 * a Web `WritableStream`, plus a `then` for awaiting full completion.
 *
 * @example
 * ```tsx
 * import { renderToStream } from "@solidjs/web";
 *
 * // Node:
 * renderToStream(() => <App />).pipe(res);
 *
 * // Web (Workers / Deno):
 * await renderToStream(() => <App />).pipeTo(stream.writable);
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
} {
  throwInBrowser(renderToStream);
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
