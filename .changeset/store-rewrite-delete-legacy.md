---
"@solidjs/signals": patch
---

Store rewrite: legacy implementation deleted. The store module now has a
single implementation — the rewrite's single-home storage model (raw as
truth, CoW pending backings, lazy per-property nodes, adoption-channel
reconcile) serves every public form: plain, shallow, derived, projection,
and optimistic stores. `store.ts` is reduced to shared machinery (symbols,
raw-marking, wrappability, affects scopes), the transitional dispatchers are
gone, and the package is ~0.9kb gzip smaller than before the rewrite while
carrying the same contract.
