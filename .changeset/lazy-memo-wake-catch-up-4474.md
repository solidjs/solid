---
"@solidjs/signals": patch
---

A memo released unread at its source's landing (#2934) and woken in a flush that re-asks the source now reads as a memo a prior reader kept alive would: `latest()` of it is the landed value and `isPending()` of it is `true`, in either read order — laziness is never observable (D-22, #4474). A dormant memo's wake pass is served the committed value of a flight it reads and is then marked pending on that flight; one with no committed value catches up on the committed world (the screen) and re-derives over this flush's staging or verdict lane after; a released node stays uninitialized through the commit sweep so its wake does compute.
