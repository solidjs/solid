---
"@solidjs/signals": patch
---

A reader of a derived store whose derive carries a staged error (D-41) now links to the derive, as a reader of a pending or errored one does, so it re-runs when the derive's source answers. An `<Errored>` mounted in the change that errored its content over a keyed `createProjection` showed its fallback for good; it now shows the answer.
