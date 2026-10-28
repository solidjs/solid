---
"@solidjs/signals": patch
---

A reader created in the flush that clears an upstream error, under `<Errored>` and `<Loading>`, now shows the async memo's error once it rejects, instead of an empty hole. The rejection re-ran the error boundary outside the hold that had staged its content, and the boundary went back to the fallback it had already committed. Because that was no change, the boundary's reader did not re-run, and the hold's landing applied its stale run of the content. When a boundary's re-run replaces a staging of its output, the readers of that output now re-derive (#4378).
