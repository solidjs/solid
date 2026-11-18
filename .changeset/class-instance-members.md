---
"@solidjs/signals": patch
---

A prototype getter on a class instance in a store now runs on the store proxy, so it tracks the fields it reads (CS-R48). Before, a getter read with no store node yet ran on the raw instance and never updated.
