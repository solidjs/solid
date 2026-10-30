---
"@solidjs/signals": patch
---

A verdict reader born into a hold reads that hold's value of a node it holds in every flush, not only the hold's own: one run by another transaction's flush was served the committed value (#4426).
