---
"@solidjs/signals": patch
---

Region change/admission detection fused into the reconcile walk's per-key loop: region-bound records latch value changes and accessor sightings inside the existing comparisons instead of paying a second full scan per adoption — dbmon tick returns to driver parity (2.1ms) with the round-2 gating semantics intact.
