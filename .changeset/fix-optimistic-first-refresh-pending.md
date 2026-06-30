---
"@solidjs/signals": patch
---

Fix `isPending` staying false on the first `refresh()` of an async `createOptimistic` accessor when `isPending` is the only reactive consumer.
