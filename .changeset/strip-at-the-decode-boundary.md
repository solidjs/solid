---
"@solidjs/web": patch
---

Apply the prototype-key strip at the decode boundary instead of at one of its callers. `__proto__` / `constructor` / `prototype` were removed from decoded POST arguments by a strip attached to the argument path in the server, so every other graph the same decoder produced — above all every response the client decodes, and the no-JS flash cookie — handed the key through as an own property. No hostile server is required: a function returning `JSON.parse` of stored user text emits it through the JSON fast path, and any recursive merge on the client then writes through to `Object.prototype`. The guard now lives in `extractBody`, the boundary all three roads share, so the argument leg's existing guarantee and the two that were missing are one implementation rather than copies to keep in sync.
