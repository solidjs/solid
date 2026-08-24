---
"@solidjs/signals": patch
---

Fix async-generator projection derives wedging when the continuation reads its own draft (e.g. `state.push(item)` after an `await`, which reads `state.length`). The store rewrite's seed-invisibility firewall gate did not exempt own-draft operations running outside the sync write scope, so the read threw NotReadyError back into the derive and the post-await read diagnostic halted the reactive system — any Loading boundary over the projection stayed on its fallback forever. Own-draft ops carry the projection write override and now bypass the gate, matching the exemption the reconcile and draft-serve paths already had.
