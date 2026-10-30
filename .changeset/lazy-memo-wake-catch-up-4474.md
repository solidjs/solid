---
"@solidjs/signals": patch
---

A lazy memo released unread at its source's landing (#2934) and woken in a flush that re-asks the source catches up on the committed world: `latest()` of it is the landed value and `isPending()` of it is `true`, in either read order, as with a prior reader — laziness is never observable (D-22, #4474). Its wake pass is served the committed value of a flight it reads and is then marked pending on that flight; a released node stays uninitialized through the commit sweep so the wake does compute.
