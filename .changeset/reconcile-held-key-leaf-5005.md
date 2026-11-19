---
"@solidjs/signals": patch
---

A `reconcile()` during a pending action now publishes the keys the action does not hold, whether or not anything reads them (#5005).
