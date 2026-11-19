---
"@solidjs/element": patch
---

fix(element): declared custom element props are enumerable, so `{ ...props }` and `Object.keys(props)` see them (#5058)
