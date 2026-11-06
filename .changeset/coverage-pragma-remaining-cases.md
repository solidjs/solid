---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Carry authored `istanbul`/`c8` ignore pragmas through the remaining #2138 cases: a pragma immediately before a component (including through a fragment) leads that component's `children` getter, pragmas inside fragments are preserved, and SSR prop-hoist copies them onto the shared descriptor's `get()`.
