---
"solid-js": patch
---

- Hydration facades (`createMemo`, function-form `createSignal`/`createOptimistic`, function-form `createStore`/`createOptimisticStore`, `createProjection`, `createErrorBoundary`, `createLoadingBoundary`, effects) no longer throw when created with no owner (`runWithOwner(null, …)`) or under a root without an `id` while hydrating. A node with no id counter to consume has nothing to hydrate positionally, so it takes the same non-hydrating path as `transparent: true`. Function-form `createSignal` now honors `transparent` like `createMemo` does (#3609).
