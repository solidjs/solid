---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Projection (non-optimistic) family arrays are drivable by the patch-mode list driver: their recomputes walk reconcile, whose row/slot emissions were never family-gated and ride the transition-stamped apply queue. The blanket family decline narrows to optimistic families only (`storeHasOptimisticFamily`), whose user writes ride node overrides and emit no structural ops. Fixes chained-backing patch registration: a projection wrapper's backing is another store's proxy, so `registerPatch`/`patchableRaw` now resolve through the chain to the ultimate owner target — patches registered on wrapped projection rows previously never fired (value transitions fold on the source). Equivalence matrix extended with 13 projection scenarios including recompute-driven structure and retention topology.
