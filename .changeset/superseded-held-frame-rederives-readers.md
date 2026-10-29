---
"@solidjs/signals": patch
---

A reader created in the flush that clears an upstream error, under `<Errored>` and `<Loading>`, now shows the async memo's error once it rejects, instead of an empty hole. The rejection re-ran the error boundary outside the hold that had staged its content, and the boundary went back to the fallback it had already committed. Because that was no change, the boundary's reader did not re-run, and the hold's landing applied its stale run of the content. A held frame node that re-runs outside its hold now re-derives the readers of the staging it replaces (#4378).
