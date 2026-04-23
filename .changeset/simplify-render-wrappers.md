---
"@solidjs/web": patch
"@solidjs/universal": patch
---

Simplify `render` wrappers and give custom universal renderers deferred top-level mount.

`@solidjs/web`'s `render()` is now a thin wrapper around `dom-expressions`' `render` — it threads `{ insertOptions: { schedule: true } }` through the new `insertOptions` seam (added in `dom-expressions@0.50.0-next.2`), scopes the `ASYNC_OUTSIDE_LOADING_BOUNDARY` dev window, and tail-flushes the queue. No behavioral change for end users; the local `createRoot` / `flatten` / `insert` plumbing that was inlined in the previous commit has moved back into `dom-expressions`.

`@solidjs/universal` is no longer a pure re-export of `dom-expressions/src/universal.js`. It wraps `createRenderer` so the returned `render(code, element)` does `createRoot` + `insert(..., { schedule: true })` + tail `flush()`. Every custom universal renderer now inherits the same permissive top-level async semantics as `@solidjs/web`, without having to rewrite its own `render`.
