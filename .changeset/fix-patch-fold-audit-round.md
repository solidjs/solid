---
"@solidjs/signals": patch
---

Close the fold-audit P1s on the patch channel and the #3164 reveal seam: held slot deliveries defer per index instead of collapsing to the first (later slots stayed stale behind holds), the late-registrant sweep runs once at drain end against the highest emission watermark (a resync followed by a later item's stale ops double-built rows), staged truth no longer merges into raw shallow rows (in-place mutation was visible before the reveal with no notification — raw children now replace their slot wholesale), and staged-truth folds emit row ops and slot ticks at the reveal (the optimistic-family gates exist for override materializations; a root array retained only through a descendant's override was revealing silently).
