---
"@solidjs/signals": patch
---

A guess in a second `createOptimistic` now shows at once while another action's `refresh()` of a list the overlay also reads is still in flight, whatever order the overlay reads them in (#4666).
