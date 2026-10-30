---
"@solidjs/signals": patch
---

A landing that settles a reader held by an optimistic lane no longer makes the flush join that lane as its transaction: rows a list guess mounted over a pending refresh render instead of staying empty.
