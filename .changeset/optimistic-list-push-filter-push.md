---
"@solidjs/signals": patch
---

Optimistic keyed lists: a push after a filter (with earlier saves still out) no longer hands `<For>` an `undefined` row, and a list re-based beneath a guess settles to the server's rows by key instead of committing the composed rows by position (no duplicated or empty rows after a declined delete, or an add made before the first load).
