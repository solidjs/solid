---
"@solidjs/signals": minor
---

Add `loadingValue` (`createMemo` / `createSignal(fn)` / `createOptimistic(fn)`) and `seedLoadingValue` (`createProjection` / `createStore(fn)` / `createOptimisticStore(fn)`): commit #0 for async sources. The node is born committed with the loading value (the projection's seed) and serves it everywhere during the compute's first flight — no NotReadyError propagation, no Loading-boundary suspension, no transition holds (first-flight work is loading-class, like a boundary fallback) — while `isPending` on the source reports true so loading affordances can be driven from the value itself. The first real answer closes the window permanently: refetches use normal pending semantics. `loadingValue` is typed strictly as `T` (nullable placeholders require a nullable node type) and seeds the compute's first `prev`.
