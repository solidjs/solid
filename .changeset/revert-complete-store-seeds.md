---
"@solidjs/signals": patch
"solid-js": patch
---

Revert the complete-seed requirement on derived store forms (#3258). Derived `createStore`, `createProjection`, and derived `createOptimisticStore` accept `Partial<T>` seeds again, on maintainer review: requiring a full `T` forces callers to fabricate a throwaway complete object in the common async case — any object store reconciling on a non-`id` key needs the options slot, hence the seed slot — while the seed is never observable there (reads pend until the first resolution). The type-honesty concern it addressed is real only for sync draft-reading callbacks and is better served by the seedless-callback direction discussed in #3194. Since #3258 never shipped in a release, its pending changeset is dropped rather than superseded; the API is unchanged from 2.0.0-rc.6. The #3260 overload alignment (slot order, `shallow` in options, `Refreshable` derived returns) is unaffected.
