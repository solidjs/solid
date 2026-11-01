---
"@solidjs/signals": patch
---

The `UNSTABLE_LIST_IDENTITY` diagnostic reads a row's `id`/`key`/`_id` only from an own data property, so it never invokes a getter (a class instance's prototype `id` or an own accessor) while pairing rows.
