---
"@solidjs/signals": patch
---

Prototype `witness()` coarse read: subscribe one record's deep-witness node and serve the raw backing — the coarse-row read model (zero leaf nodes/links/wrap caches per row). Hand-compiled dbmon rows: mount 0.70x, unmount 0.61x, tick 0.90x vs fine-grained.
