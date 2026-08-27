---
"@solidjs/signals": patch
---

Fix projection stores leaking unsettled writes to effect-phase readers (#3082)

A derived (projection) store's pending backing is authoritative-elect and served to context-free readers, but that clause also caught CHILDREN_FORBIDDEN execution scopes (`onSettled` / `createTrackedEffect` callbacks), so `setStore(...)` followed by a read inside the callback returned the staged draft while a signal write in the same scope correctly read committed. Projection reads in those scopes now get committed visibility, restoring the #3006 contract (a callback never observes its own unsettled write) and store/signal parity.
