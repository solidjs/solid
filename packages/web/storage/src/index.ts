import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestEvent } from "@solidjs/web";
import { isServer, RequestContext } from "@solidjs/web";

/**
 * Establishes the request-event scope for a server request: everything
 * `cb` runs (across `await`s, via AsyncLocalStorage) sees `init` from
 * `getRequestEvent()`. Call it at the top of the server's request handling,
 * wrapping SSR and server-function dispatch; the server-functions runtime
 * also picks the scope up automatically as its default event provider.
 *
 * Lives on its own subpath because it imports `node:async_hooks` — keep it
 * out of environments without that module.
 *
 * @example
 * ```ts
 * import { provideRequestEvent } from "@solidjs/web/storage";
 *
 * async function handler(request: Request) {
 *   return provideRequestEvent({ request, locals: {} }, () =>
 *     renderToStream(() => <App />)
 *   );
 * }
 * ```
 *
 * @param init the event for this request — frameworks pass their richer
 * event shapes
 * @param cb runs synchronously; its return value is passed through
 * @throws on the client, where there is no request to scope
 */
// The storage instance lives on globalThis under a registered symbol so
// separately bundled copies of the runtime find the same one, and so
// environments without async_hooks can detach cleanly.
export function provideRequestEvent<T extends RequestEvent, U>(init: T, cb: () => U): U {
  if (!isServer) throw new Error("Attempting to use server context in non-server build");
  const ctx: AsyncLocalStorage<T> = ((globalThis as any)[RequestContext] =
    (globalThis as any)[RequestContext] || new AsyncLocalStorage<T>());
  return ctx.run(init, cb);
}
