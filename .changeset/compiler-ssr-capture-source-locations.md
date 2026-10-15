---
"@solidjs/compiler": patch
---

Preserve the source location of captured references in SSR props constructors so source maps point to the authored expression instead of the start of the JSX element, matching `@solidjs/babel-plugin`.
