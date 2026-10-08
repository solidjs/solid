---
"@solidjs/web": patch
---

`readShallow` (the compiler's one-layer tracked read of an object-valued `class`/`style`) reads a proxy's keys with `Reflect.ownKeys` directly — what `sourceKeys(value, SOURCE_PROXY)` resolves to by definition — instead of through `sourceKeys`, whose runtime kind argument kept the merge/omit view walkers of `@solidjs/signals` in every compiled page with a dynamic `class` or `style`, reached by nothing. Identical behaviour; −1,165 B minified / ≈ −350 B brotli on the compiled server-component page (a page with an element spread keeps the walkers through `spread()`).
