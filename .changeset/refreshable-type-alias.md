---
"solid-js": patch
---

Introduce `Refreshable<T>` as a public type alias for the `$REFRESH` brand applied to derived/projected stores. The return types of `createOptimisticStore`, `createProjection`, and the projection form of `createStore` now use `Refreshable<Store<T>>` instead of inlining `Store<T> & { [$REFRESH]: any }`.

This fixes a TS4058 error in user-defined hooks that wrap these primitives — the inferred return type would previously reference the unique `$REFRESH` symbol from a deep import path, forcing consumers to write an explicit return annotation. `Refreshable` is re-exported from both `@solidjs/signals` and `solid-js` (client + server entries) so the inferred type is now nameable from any consumer.
