---
"@solidjs/signals": patch
---

A declined optimistic edit now reverts in a list row that a `Show` is about to replace, at the same moment as everywhere else (#5077). Before, when the frame that would remove the old row was still waiting on another action, the row kept showing the declined value while a memo over the same store showed the truth.
