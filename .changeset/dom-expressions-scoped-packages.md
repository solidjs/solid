---
"@solidjs/web": patch
"@solidjs/h": patch
"@solidjs/html": patch
"@solidjs/universal": patch
---

Update dom-expressions to 0.50.0-next.15 under the new `@dom-expressions` npm scope (`@dom-expressions/runtime`, `@dom-expressions/babel-plugin-jsx`, `@dom-expressions/hyperscript`, `@dom-expressions/tagged-jsx`). Includes the upstream fix where awaited `renderToStream` now waits out blocked root holes (#2779) and the server `mergeProps` sourcing fix (#2815). `@solidjs/html`'s runtime shim follows the upstream SLD → Tagged JSX rename (`createTaggedJSXRuntime` / `TaggedJSXInstance`).
