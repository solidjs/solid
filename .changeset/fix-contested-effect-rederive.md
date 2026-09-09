---
"@solidjs/signals": patch
---

Fix a render effect that reads sources written by two concurrent, non-entangled transactions committing the wrong value and then never updating (#3322). Effects have one value slot and do not entangle transactions, so the second transaction's recompute overwrote the value the first still owed a run for; the first's silent commit then published it, and the second found nothing left to run. Such effects are now re-derived against the committed world at each owed commit, ahead of the effect phase. The same mechanism covers a mainline recompute of an effect a live transaction had computed (the transaction's commit re-derives it), and render effects recomputing with no transaction active no longer see a foreign transaction's staged signal through the read fast path — the mask the slow path already applied.
