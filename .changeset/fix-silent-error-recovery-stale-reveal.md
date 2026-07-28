---
"@solidjs/signals": patch
---

Fix `createErrorBoundary`/`Errored` revealing stale content when a failing source recovers by recomputing to a value equal to its last committed one (#2949). Such a recovery fires no value notification, but dependents that re-ran during the error window consumed their dirty flag in an errored run — fresh sibling values were absorbed and nothing committed. `recompute` now mirrors `settlePendingSource`'s blocked re-enqueue on the error dimension: a silent recovery sweeps dependents still holding the propagated error object (one identity down the whole tree) and re-enqueues them, so fresh values commit and flow, and a dependent with another still-broken source simply re-errors.
