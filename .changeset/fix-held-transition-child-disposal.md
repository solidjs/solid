---
"@solidjs/signals": patch
---

A node recomputed under a held transaction no longer tears down the committed frame's children immediately. Status propagation stamps a parked dependent with the transaction without recomputing it, so its owned children (nested render effects, memos, `onCleanup` registrations) still belong to what is on screen; when the pending source landed, the recompute disposed them on the spot and their cleanups ran mid-hold, before the transaction's atomic reveal (#3404). Those children are now deferred as zombies until the node commits, matching the plain-flush path. Children built by a recompute that never committed (a staged value, a pending window, a run under the transaction) are still disposed immediately on the next re-run — no frame ever showed them.
