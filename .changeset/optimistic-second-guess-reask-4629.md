---
"@solidjs/signals": patch
---

A second action's guess into an optimistic slot now shows at once while the first action's `refresh()` of a list the overlay also reads is still in flight, whatever order the overlay reads the two in (#4629).
