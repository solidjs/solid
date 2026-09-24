---
"@solidjs/signals": patch
---

`OPTIMISTIC_REVERTED` (info, responsiveness): an optimistic value the screen showed was replaced by a different one — reverted at settle, or superseded by the truth — with the source and both values. `AttributionHooks.optimisticReverted` is the seam; `optimisticReverts: false` disables it. The runtime's own optimistic nodes (`isPending`/`latest` companions, derived overrides) are never judged.
