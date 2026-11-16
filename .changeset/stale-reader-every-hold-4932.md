---
"@solidjs/signals": patch
---

A declined guess reverts everywhere it is read while other actions are still out (#4932). A memo-fed heading over an optimistic store row kept showing a declined rename while the list beside it reverted: in one pass the heading read two holds (the re-asked list's and the rename's), and a reader was recorded only on the first hold it read, so the rename's landing never re-ran it. A reader is now re-run by every hold it read committed from.
