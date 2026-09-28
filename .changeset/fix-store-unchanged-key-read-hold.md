---
"@solidjs/signals": patch
---

Reading a store key an open action did not write no longer holds the reader with that action (#3688). The store's container-level hold gate entered a deriving pass into the transaction for any key of a held container; a memo reading an unchanged `store.stable` beside an independent signal was held until the action settled, and the signal's `isPending` went true. The gate now consults the fold's written-key record (`wk`) for `get`, `has` and descriptor reads: a key the fold never wrote or deleted reads the same from either backing and is served committed with no entry — the same per-key precision node reads already had. `ownKeys`, `$TRACK` and `deep()` stay container-wide; optimistic families, chained backings, folds with no trap record and array-length writes keep the whole-container hold.
