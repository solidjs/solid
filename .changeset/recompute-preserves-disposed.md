---
"@solidjs/signals": patch
---

A computation that disposes its own owner during its recompute (a memo calling its root's `dispose()`) stays disposed: `recompute`'s `finally` now carries `REACTIVE_DISPOSED` alongside `REACTIVE_ZOMBIE` instead of dropping it, and the pass is void — dependencies re-linked after the `dispose()` call are unlinked, a flight it started is retired, and its value is neither committed nor propagated (a dead node freezes at its last committed value). `isDisposed()` reads true and `refresh()` no longer re-runs it into a torn-down tree (#3621).
