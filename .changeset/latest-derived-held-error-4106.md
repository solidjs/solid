---
"@solidjs/signals": patch
---

A memo over `latest(source)` now sees a held rejection at the same point it sees a held value (#4106). Such a memo is display-ahead (F-6): when a held flight on `source` resolves, the memo re-runs in the hold's verdict lane and its new value shows at once, while a sibling still holds the frame. A rejection did not reach it the same way. `stageError` woke the memo but scheduled no flush, so the memo kept its old value until the reveal. After the memo did re-run, its lane pass errored, but `latest(memo)` and `memo()` kept serving the lane value from before the error, while the memo's effect had already received the error. Now `stageError` schedules the flush, and a read of an errored lane member that is not a written guess throws its error. `latest(memo)`, `memo()` and the effect's error arm now show `boom` before the reveal, just as they show `2` when the source resolves.
