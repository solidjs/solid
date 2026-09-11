---
"@solidjs/web": patch
---

Revert #3187's deferred element creation in `Dynamic`. String-component `Dynamic` is once again an element at component creation on the client — `spread` and `ref` callbacks run then, matching the hydration path — instead of a thunk materialized by the consuming `insert()`. The deferral moved ref writes into the render phase of the flush for `<Dynamic>` inside `<Portal>`, where `createTrackedEffect` readers never observed them (#3291: every Kobalte popper rendered unpositioned). The namespace of ambiguous tags (`a`, `script`, `style`, `title`) rendered through `Dynamic` inside SVG content is an accepted limitation, as in 1.x; use a static element for those.
