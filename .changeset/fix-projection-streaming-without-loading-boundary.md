---
"solid-js": patch
---

Fix `createProjection` streaming when no outer `Loading` boundary is present. Two related bugs were fixed, plus a small internal refactor:

- The synchronous `reconcile` path in `createProjectionInternal` now goes through `storeSetter` so the `writeOnly` guard is engaged during reconcile reads. Previously it bypassed the guard, causing the projection's own reads (via its store's `_firewall`) to be tracked as dependencies, dirtying the projection mid-recompute and producing a runaway self-loop.
- `recompute` now snapshots `_inFlight` before running the node's `_fn`. When `_fn` self-registers an async subscription (as `createProjection` does via an internal `handleAsync(owner, asyncIterable, setter)` call that returns `undefined` from the body), the outer `handleAsync(el, undefined)` would otherwise clear `_inFlight` and drop every subsequent yielded value. The snapshot lets `recompute` skip the outer `handleAsync` in that case and keep the internally-registered iteration alive, so projections stream all values (not just the first) regardless of whether a `Loading` boundary is present.
- Internal: the projection recompute body (`draft + storeSetter + handleAsync + commit`) is now shared between `createProjection` and the derived form of `createOptimisticStore` via a `runProjectionComputed` helper. As a side-effect this routes optimistic projections' sync commit through `storeSetter` too, bringing them in line with the fix above.
