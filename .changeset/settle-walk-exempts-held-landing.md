---
"@solidjs/signals": patch
---

Exempt transition-held landings from the settlePendingSource uninitialized-source invariant. A held async landing stages its value in `_pendingValue` and stays STATUS_UNINITIALIZED until the masking override commits (#2806), so the truth exists even though the node reads uninitialized — the invariant now fires only when there is no staged value, matching its "source produced nothing" contract and keeping the pre-existing held-landing settle behavior intact.
