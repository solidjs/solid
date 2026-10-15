---
"@solidjs/signals": patch
---

The errored-store refetch guard lives on the store pull, so a bundle that never reads a store does not carry it
