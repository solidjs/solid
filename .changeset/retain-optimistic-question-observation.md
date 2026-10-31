---
"@solidjs/signals": patch
---

Keep observing a pending store query when a later optimistic guess re-runs an existing reader, so shared bindings do not show the new query's inputs beside rows from the previous answer.
