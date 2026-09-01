---
"@solidjs/signals": patch
---

Entangle-tear consolidation pass 1: untracked store reads now serve committed truth for held-truth-masked nodes (the until()-flip steal parks node truth past the flush, so the backing is ahead of the committed world — tracked and untracked readers previously disagreed); patch-channel deliveries and structural applies defer on parked truth, riding the holding transaction's commit via the holder named by the nodes' own `_transition` — one seam decision that follows merges and steals with no scheduler-specific mirrors.
