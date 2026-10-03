---
"@solidjs/signals": patch
"@solidjs/universal": patch
"@solidjs/web": patch
---

Support finite synchronous iterables, such as `Set` and custom `Symbol.iterator` collections, as JSX children. Iterables are normalized into arrays for DOM and universal rendering, SSR, and hydration.
