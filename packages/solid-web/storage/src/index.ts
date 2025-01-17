import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestEvent } from "@solidjs/web";
import { isServer, RequestContext } from "@solidjs/web";

// using global on a symbol for locating it later and detaching for environments that don't support it.
export function provideRequestEvent<T extends RequestEvent, U>(init: T, cb: () => U): U {
  if (!isServer) throw new Error("Attempting to use server context in non-server build");
  const ctx: AsyncLocalStorage<T> = ((globalThis as any)[RequestContext] =
    (globalThis as any)[RequestContext] || new AsyncLocalStorage<T>());
  return ctx.run(init, cb);
}
