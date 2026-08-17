---
"solid-js": patch
---

Server async convergence hardening (#3003). Async reads that hand back a
fresh promise per call (e.g. the router's `query()` cache-hit `.then()`
wrapper) defeated the promise-stamp adoption during boundary retry
discovery: every pass re-suspended with a new deferred, looping at
microtask speed until the process ran out of memory. The render context now
keeps a per-slot flight record keyed by owner id — re-creations of a slot
join the existing in-flight deferred (one serialization per slot, ever) and
adopt settled answers synchronously. A settled answer always resolves the
serialized deferred even when the computing node was superseded and
disposed, so the response stream can always close (previously a superseded
pass's serialized deferred dangled and held the connection open forever).
Discovery is additionally capped by a retry budget that fails the boundary
loudly instead of looping unbounded.
