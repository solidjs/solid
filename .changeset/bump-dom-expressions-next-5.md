---
"solid-js": patch
---

Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.5. Picks up the document-root reactivity fix: `render(..., document)` and `hydrate(..., document)` now wrap the rendered tree in a transparent render effect (mirroring what `insert` does for non-document roots), so a top-level reactive expression at the document root stays driven by signal changes after the initial flatten. Previously the document-root path called `flatten(code)` and discarded the subscription scope, leaving any top-level memo idle after the first walk — most visible with full-document hydration as in TanStack Solid Start. The new JSDoc on the JSX `class` attribute (a string vs. array+object form note carried up from dom-expressions) is also picked up.
