---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Make a failed lazy() hydration observable instead of a silently dead page (#3338):

- The client's "was not preloaded before hydration" error no longer says to add a Loading boundary — none is required for root-level `lazy()`. It now names the actual cause: the server serialized no client entry for the module (check the server log for "Asset manifest returned no client assets for module"), or the hydration id namespaces are misaligned.
- An uncaught error that halts the reactive system is handed to `reportError` where the platform provides it, so it reaches `window.onerror` / error monitoring. Creation-time throws (a lazy miss during the hydration render) are converted to status by ancestor recomputes and never reached the top; console.error was their only trace.
- `hydrate()`'s "module preload failed → fall back to client render" path no longer runs for a document root, where a client render is impossible (the shell cannot be created) and died deep in the walk with an unrelated "Hydration Mismatch" as an unhandled rejection. It now reports an explicit error carrying the preload failure as its cause.
