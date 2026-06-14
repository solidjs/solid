---
"@solidjs/signals": patch
"solid-js": patch
---

Fix `createProjection` seed typing so readonly store seeds do not override inference from the projection function return type.
