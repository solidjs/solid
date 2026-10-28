---
"@solidjs/signals": patch
---

A reader created in the flush that clears an upstream error, under `<Errored>` and `<Loading>`, shows the async memo's error once it rejects instead of an empty hole. The rejection re-ran the error boundary outside the hold that had staged its content, back to the fallback it had committed; that is no change, so the boundary's reader was not re-run, and the hold's landing applied its stale run of the content. A held frame node that re-runs outside its hold now re-derives the readers of the staging it replaces (#4378).
