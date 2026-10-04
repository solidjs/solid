---
"@solidjs/signals": patch
---

Size audit (measurement branch): the fold queue records a pre-batch backing only for adoptions (whose backing swaps eagerly), in a weak map written in place batch after batch; a draft's pre-batch backing is its own committed backing, so nothing is recorded for it — 2000 fresh one-key stores per flush had cost 2000 weak-map insertions and ran at 2× `next` (CodSpeed's `fresh stores` bench). The two rare moves of a draft's backing mid-batch (a privatization, a draft over an adopted raw) are kept in small per-batch maps.
