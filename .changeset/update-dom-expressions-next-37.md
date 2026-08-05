---
"@solidjs/web": patch
"babel-preset-solid": patch
---

Update dom-expressions to 0.50.0-next.37. Serialized server-component references now self-bootstrap the `_$SC` registry — each hydration script's first reference carries it as an idempotent expression — so no integration needs to splice a bootstrap script into `<head>`. The old head-open splice (vite-plugin-solid) put a script ahead of the authored head elements, where the hydration walk claimed it as the first walked child and drifted every positional claim in the head by one (metas claimed as title, title as link), warning in dev and silently drifting in production. The compiler also picks up the directive-DCE fix for type-only import remnants (solid-start #2273): pruning the last value specifier out of a mixed import now removes the whole declaration instead of leaving a bare server-module edge in the client bundle.
