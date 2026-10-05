---
"@solidjs/signals": patch
"solid-js": patch
---

Infer `createEffect` and `createRenderEffect` compute results as const so inline tuple results retain their element types without a type argument or `as const`.
