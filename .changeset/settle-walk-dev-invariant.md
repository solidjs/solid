---
"@solidjs/signals": patch
---

Dev-only invariant diagnostic in settlePendingSource: walking a settle implies truth exists. A future call site that reaches the walk with an uninitialized source now fails loudly in development (SETTLE_WALK_UNINITIALIZED_SOURCE) instead of waking parked readers into a value that was never produced.
