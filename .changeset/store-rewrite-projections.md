---
"@solidjs/signals": minor
---

Store rewrite: next-native projections are now the default. `createProjection`
(sync, async, generator, and chained forms) runs on the single-home storage
model — firewall status gating links tracked readers for NotReady wake-up,
write scope extends through draft reads (cross-store draft writes preserved),
and fold-time parent-slot fixes are compare-and-swap so draft array splices
cannot resurrect removed rows. Unkeyed nested objects in async yields now
merge in place (identity preserved) instead of accidentally replacing.
