---
"@solidjs/signals": patch
---

A cleanup that throws while an unfinished pass's frame is dismantled no longer strands the lazy nodes released before it: they are released before the error propagates.
