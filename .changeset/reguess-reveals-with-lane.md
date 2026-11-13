---
"@solidjs/signals": patch
---

A second optimistic guess whose consequence is still pending no longer reaches a reader re-run by an unrelated write: it is shown with its lane's next reveal (#4775).
