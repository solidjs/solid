---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Second re-audit hardening of the patch channel: adoption seams demote accessor-bearing adoptees to tracked effects (reconcile walk + fold commit); setter-returned root replacements and chained-store swaps emit their patches and row ops at fold commit; the list driver's ops application builds every new row before any destructive step (a throwing row factory leaves DOM and bookkeeping atomically unchanged); patch errors route to the nearest computed ancestor so `Errored.reset()` can recompute it (reset also skips non-computed sources), and unhandled patch errors halt like unhandled effect errors; key equality is SameValueZero and occurrence-aware everywhere keys compare — NaN keys stay retained and duplicate keys adopt per occurrence on both channels; same-batch duplicate patch emissions coalesce (one application per batch, effect parity).
