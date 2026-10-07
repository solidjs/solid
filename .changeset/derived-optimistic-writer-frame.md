---
"@solidjs/signals": patch
---

Compare optimistic store writes against the committed backing frame of chained stores, so a writable derived store's held staging cannot suppress an optimistic override.
