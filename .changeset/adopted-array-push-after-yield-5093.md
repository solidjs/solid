---
"@solidjs/signals": patch
---

A store array that an action replaces with a returned array, then pushes to after a `yield`, now maps the pushed row in `mapArray` and `<For>` instead of `undefined` (#5093).
