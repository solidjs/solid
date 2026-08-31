---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Round-10.5 audit fixes: the delivery pending-dedup is transition-aware (scheduler owns merge bookkeeping — every bump under a transition reaches the signal), deep-path admission currency-probes aliased raw slots, payload-less (bubbled) deliveries re-probe the ancestor's deep manifest and demote getters, demoted entries are severed against stale held callbacks, list resyncs rebuild across family changes, shallow swaps keep raw retention, and optimistic revert sites no longer double-bubble ancestors.
