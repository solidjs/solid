---
"@solidjs/signals": patch
---

Disposal removes computations from the scheduler heaps regardless of their dependency list, so a disposed computation can never be recomputed by a later flush. The child walk in `disposeChildren` only deleted queued children from the heap inside its `if (child._deps)` branch — a dependency-free memo queued by `refresh()` stayed queued, the post-disposal flush recomputed it, and `recompute()` rewriting `_flags` cleared `REACTIVE_DISPOSED`: the node came back to life (user code running after unmount, the accessor readable again, cleanups from the post-disposal run leaked, #2983). The standalone `dispose()` path gains the same heap removal for the node itself, mirroring `unobserved`.
