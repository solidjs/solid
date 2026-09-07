---
"@solidjs/signals": patch
"solid-js": patch
---

Attribution: `UNSTABLE_LIST_IDENTITY` diagnostic. When a `mapArray`/`<For>` update disposes and recreates most rows while the entering items are field-for-field equivalent to the ones they replaced (a re-fetch handed back fresh objects for the same records under identity keying, or a key function returned unstable keys), every row's DOM and state was thrown away and rebuilt for data that did not change. `mapArray` now hands the exited and entered items to the attribution engine after a churning commit (`AttributionHooks.listChurn`); the engine pairs them (by `id`/`key`/`_id` when present, else by position), samples shallow equivalence, and warns once per list naming the repair — key by a stable field or merge with `reconcile(data, "id")`, or, when a key function is already in use, return a stable field from it. `mapArray` nodes now carry the `name` option as their node name in dev so the list is named in the report.
