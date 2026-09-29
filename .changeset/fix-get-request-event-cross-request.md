---
"@solidjs/web": patch
---

`getRequestEvent()` no longer returns another request's event. When the request store came back empty (a sync-only `async_hooks` polyfill after an `await`, a callback the store does not follow), it fell back to the module-global `sharedConfig.context.event`, which belongs to whichever render started or finished last, so under concurrent requests one request could read another's headers, cookies, and locals, and a direct server-function call could run under the other request's event. The fallback now resolves through the caller's owner to its own render's context (where an integration such as Solid Start writes the event), so a render pass the runtime drives keeps its event; a read that no render can be attributed to (async user code after an `await` with no store, code outside any render) returns `undefined` with the existing warning.
