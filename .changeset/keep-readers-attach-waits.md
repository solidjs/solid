---
"@solidjs/signals": patch
---

A keyed child under a display-ahead branch no longer mounts a third time when a flush parks: a re-derive that gives back the staging it superseded keeps its held readers and their children (#4417). A display-ahead branch no longer attaches with an empty text hole while a child born into the open hold is still pending (#4574).
