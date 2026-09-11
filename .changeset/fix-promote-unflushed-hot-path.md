---
"@solidjs/signals": patch
---

Recover the write-path cost of A28's deferred promotion: `recompute` no longer pays two calls and an array truncation per run when it wrote nothing (the unflushed list lives in core.ts and is compared locally), `promoteUnflushed` returns before truncating an empty list, and plain nodes skip the override probe. update1to1 was ~25% slower on the #3337 head; the residual is the deferred subscriber walk itself (~5% on a pure-write microbench, parity on dbmon).
