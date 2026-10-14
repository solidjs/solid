---
"@solidjs/signals": patch
---

Resolve a writable derived store's retained draft row to its store proxy when an optimistic store chained over it writes, so the optimistic write to that row shows while its action is pending (#3859).
