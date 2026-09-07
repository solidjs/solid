---
"@solidjs/web": patch
---

Fix a lone reactive spread crashing when its source is `null` or `undefined` (#3297). `<input {...props()} />` compiles to `spread(el, props)` with the accessor passed through, so an absent optional props object threw inside `spread()` (and `ssrElement` on the server) and halted the app's updates. A nullish source is now an empty spread: attributes applied by the previous value are removed and reactivity continues.
