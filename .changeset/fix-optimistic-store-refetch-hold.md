---
"@solidjs/signals": patch
---

Bare optimistic store writes made while the store's own refetch is in flight now hold until truth lands and compose across consecutive writes, instead of reverting at plain flush end and clobbering each other (#2951)
