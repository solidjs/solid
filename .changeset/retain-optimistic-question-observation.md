---
"@solidjs/signals": patch
---

Keep observing a pending store query when a later optimistic guess re-runs an existing reader, so bindings (shared or separate) do not show the new query's inputs beside rows from the previous answer, and the new answer's rows never show beside the old query for a frame when it lands.
