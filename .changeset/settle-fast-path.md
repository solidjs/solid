---
"@solidjs/signals": patch
---

The seam (`settle`) no longer pays the effect-queue merge on a plain flush — nothing parked, no lane reveal, no landing: this flush's runs are the queue as they stand instead of a `concat` copy, a parked flush stashes its runs in place, and the per-flush list resets run only when a list is non-empty. About 100 ns less fixed cost per flush (−11% on a 20k-key store commit, −45% on a one-signal flush), with the effect order of every other seam unchanged.
