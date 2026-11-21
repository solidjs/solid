---
"@solidjs/compiler": patch
---

The DOM output no longer compiles a `<noscript>` element's JSX children when the `<noscript>` is a template root or has its own dynamic attribute or spread, matching `@solidjs/babel-plugin`.
