import type { ServerErrorHook } from "solid-js";

// The server error hook of the render serving each request (its `onError`),
// keyed by the request event. An in-process server-function call reports its
// failure through the hook of the request it was made under, however late it
// fails: after an `await` no render is on the stack, and the module-global
// SSR context may by then be another request's render. Process-wide under a
// registered symbol — the server-function runtime inlines its own copy of
// this module beside the renderer's, and both must read one table.
const REQUEST_ERROR_HOOK = Symbol.for("solid-js/server/request-error-hook");

function hooks(): WeakMap<object, ServerErrorHook> {
  const g = globalThis as any;
  return g[REQUEST_ERROR_HOOK] || (g[REQUEST_ERROR_HOOK] = new WeakMap<object, ServerErrorHook>());
}

/** Files a render's `onError` as the hook of the request it serves. */
export function setRequestErrorHook(event: object, hook: ServerErrorHook | undefined): void {
  if (hook !== undefined) hooks().set(event, hook);
}

/** The hook of the render serving `event`'s request, if one was given. */
export function requestErrorHook(event: object | undefined): ServerErrorHook | undefined {
  return event === undefined ? undefined : hooks().get(event);
}
