---
"solid-js": patch
---

Bump dom-expressions/babel-plugin-jsx-dom-expressions/hyper-dom-expressions to 0.50.0-next.3. Replace lit-dom-expressions with sld-dom-expressions in @solidjs/html for an AST-driven, CSP-safe tagged-template runtime. Wire `untrack` into @solidjs/h's runtime to satisfy the new hyper API. Add small vitest smoke suites for @solidjs/h and @solidjs/html, and a `@solidjs/web#test-types` task with a tripwire for upstream `client.d.ts` re-exports of `VoidElements`/`RawTextElements`. Refresh both READMEs.
