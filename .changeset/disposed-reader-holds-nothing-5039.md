---
"@solidjs/signals": patch
---

A failed re-ask staged under a hold reaches its `Errored` once nothing is in the air, also when the fallback reads `isPending()`. A disposed reader still marked pending no longer keeps the hold's verdict lane, and the hold with it, waiting forever (#5039).
