---
"@solidjs/signals": patch
---

A reader of a derived store whose derive carries a staged error (D-41) now observes the derive, as a reader of a pending or errored one does (#4517). The pull threw the staged error before any leaf was read, so the reader subscribed to nothing in the family: when the derive's source re-asked and landed, neither the wake nor the settle reached it, and an `<Errored>` mounted in the change that errored its content stayed on its fallback over a keyed `createProjection`. The reader now links to the derive and re-runs at the landing, so the answer replaces the error.
