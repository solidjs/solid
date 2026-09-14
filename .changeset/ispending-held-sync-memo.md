---
"@solidjs/signals": patch
---

Report `isPending()` true for a synchronous memo held by a downstream async memo. The memo's staged recompute only refreshed its verdict companion inside an active transition, but a plain flush can become a hold after that recompute (an async memo pends and the batch is adopted into a transaction), so the memo read not-pending while the signal it derived from read pending (#3413).
