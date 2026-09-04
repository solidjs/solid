---
"@solidjs/signals": patch
"solid-js": patch
---

Require complete values for projection store seeds. `createProjection`, derived `createStore`, and derived `createOptimisticStore` no longer accept `Partial<T>`, preventing a store typed as `T` from being created without all required properties.
