---
"@solidjs/signals": patch
---

`isPending()` of an optimistic value now reads `true` while a changed input's request is out under a guess (`createOptimistic(() => fetch(sel()))`, an action's `setX(...)` still pending, then `sel` changes). Before, a tracked `isPending` stayed `false` until that request answered (#5255). Only the readers that probe that value with `isPending` re-run: the held screen is unchanged, a reader that reads it through `latest()` (and does not probe it) starts no new request, and a `refresh()` under a guess stays quiet.
