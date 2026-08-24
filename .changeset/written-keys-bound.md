---
"@solidjs/signals": patch
---

Written-keys notify bound: trap writes record their keys so the setter notify and fold hold-check visit O(written) nodes instead of every subscription on the record — a selection map with a thousand per-key subscribers pays two visits per select, not a full scan (tier-1 selection-map bench: 28ms → 0.31ms per 100 toggles). Falls back to the full scan for array-length writes (implicit index deletes), accessor-bearing records, and non-plain prototypes; overlay pending backings judge plainness by the committed prototype (#3044 interaction).
