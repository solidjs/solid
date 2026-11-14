---
"@solidjs/signals": patch
---

A `createProjection` or derived `createStore` whose derive writes another store's proxy into its draft (`d.selected = rows.find(...)`) now stays live. It used to keep a detached copy that later writes to the source store never reached. The return form already chained to the source, and the draft-write form now does too (#4845).
