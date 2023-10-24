import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestEvent } from "solid-js/web";
import { isServer, RequestContext } from "solid-js/web";

// using global on a symbol for locating it later and detaching for environments that don't support it.
export default function initializeServerStorage<T extends RequestEvent>(): AsyncLocalStorage<T> {
  if (!isServer) throw new Error("Attempting to use server context in non-server build");
  return ((globalThis as any)[RequestContext] =
    (globalThis as any)[RequestContext] || new AsyncLocalStorage<T>());
}
