---
"@solidjs/web": patch
"babel-preset-solid": patch
---

Update dom-expressions to 0.50.0-next.42 — the multi-root hydrate/islands fix. Pages that call `hydrate()` more than once (islands entry-clients, Astro-style one-render-per-island documents) hydrate correctly: each root re-installs its own captured registry/gather and re-arms `hydrating` across the deferred module-preload render instead of racing other roots on the shared live `sharedConfig`, and the root module map serializes renderId-scoped (`<renderId>_assets`, with a bare `_assets` fallback for the single-render islands shape) so per-island `renderToString` writes stop clobbering each other's preload maps. Whole-document renders are unchanged.
