---
"@solidjs/signals": patch
"solid-js": patch
---

Smaller bundles: builds without the optimistic-store, reveal-order or lane hook modules drop their dead branches, and the #4273/#4275 fixes share existing paths.
