---
"@solidjs/signals": patch
---

Stores on L2, S2: plain stores under holds. Every leaf read is core's `read()` (the hold rules — frame reads, joins, A28 — come from core, tracked or not); nodes are born from the two frames and held by the container's transaction only for keys the batch changed (#3706); structural reads take the container's frame; a setter's returned replacement is staged, not eager. Core: `read()`'s held arm now applies to untracked reads by a pass (a derivation of a held write is never published mainline — A29/A15).
