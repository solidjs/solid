---
"@solidjs/signals": patch
---

Smaller store bundles: the store family field (`_fam`) and its `_overlaid`, `_asked`, `_woke` and `_shallow` fields are now `_`-prefixed internals, so the prod and observe builds mangle them (no behavior change).
