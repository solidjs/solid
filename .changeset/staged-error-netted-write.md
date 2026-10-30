---
"@solidjs/signals": patch
---

Writes that net to a signal's committed value in one tick no longer hold an errored memo's re-run with an action, so `isPending` of it stays `false` (D-8).
