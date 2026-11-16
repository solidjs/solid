---
"@solidjs/signals": patch
---

A keyed optimistic store whose derive returns its answer keeps a row's guess when the row leaves the answer and comes back while the guess's action is still out (#4907). A returned answer is reconciled by key against the rows on screen, and once an answer had dropped the row there was nothing to pair it with, so the row came back as a new row showing the server's value. A returned landing now pairs its new objects with the row targets first, the same way a derive that writes its draft already did.
