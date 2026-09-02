---
"@solidjs/signals": patch
---

Regions ride the deep witness: `createRegion`/`regionBind`/`trackRecordVersion` subscribe the record's existing `dk` node (lazy, unobserved-reclaimed, change-gated by the walk/setter/fold paths that predate regions) instead of a parallel version-node — deleting the bump machinery from the hottest object-diff loop, whose growth had regressed classic uibench ~40%. The only remaining region code on classic paths is a registry-gated durable-admission probe at the walk tails.
