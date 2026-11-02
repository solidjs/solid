---
"@solidjs/signals": patch
---

`deep()` tracks and snapshots a plain store record in one walk instead of two. Records in a projection or optimistic family, chained stores and overlays keep the two walks.
