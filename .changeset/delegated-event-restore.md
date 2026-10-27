---
"@solidjs/web": patch
---

Delegated dispatch removes its `currentTarget` and `target` overrides from the native event when its walk ends, even when a handler throws. Native listeners that run later in the same dispatch, such as ones on `document`, `window` or an element above the render root, read their own `currentTarget` again instead of the last node Solid visited.
