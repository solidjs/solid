---
"@solidjs/signals": patch
---

A second action's guess into an optimistic slot now shows at once while the first action's `refresh()` of a list the overlay also reads is still in flight, whatever order the overlay reads the two in, and whether it reads the guess directly or through a memo derived from it (#4629).
