---
"@solidjs/signals": patch
---

`deep()` and `snapshot()` see an action's store writes in the pass the action lands in, as the per-key reads beside them do (#4552). A per-key read of a key under a held container asks core for the container's frame — the hold's own pass (the landing flush, a memo or effect that joined the hold) is served the staging, a frame reader outside the hold's flush the committed one (#3147) — and so does `deep()`'s enumeration walk; `snapshot()`'s composition tested the container's held flag instead, which stands until the seam, so an effect or memo over `deep(store)` re-run at the landing composed the pre-action store beside per-key reads that already showed the writes, and kept it: nothing re-runs after the commit. The composition now makes the same call core makes for a per-key read.
