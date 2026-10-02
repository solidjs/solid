---
"@solidjs/signals": patch
---

Size audit (measurement branch): the reactive engine rebuilt on the L2 hold model — transactions as the one hold relationship (membership, `blocked`, frame reads, born-held), with lanes (`createOptimistic`), verdicts (`isPending`/`latest`), boundaries (`createLoadingBoundary`/`createErrorBoundary`), `createRevealOrder` and `action` rebuilt on it as modules behind `GlobalQueue` hooks; stores, `affects()` and the attribution engine carved out pending their own steps. Every step is measured on the whole size suite and recorded in `documentation/plans/size-reduction-carve-step1.md` (§1–§28), with the maintainer's rulings that decided each behavior. Checkpoint before the §28 replay of the lane layer.
