---
"@solidjs/signals": patch
---

Store fold queue: the pre-batch committed backing is recorded beside the queued target and released with the drain. The weak map it replaces kept every container's last adopted-away backing alive until its next adoption — for a keyed reconcile, the previous tick's whole tree promoted out of the nursery every tick (the saturated listened-paths and reconcile-tree shapes ran 10–15% over `next` on that alone); for a store adopted once, the old tree for the store's lifetime. The per-batch side maps for mid-batch privatizations and drafts over adoptions fold into the same record.
