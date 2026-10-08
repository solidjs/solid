---
"@solidjs/web": patch
---

A nested server region keeps its own stream version, so a same-argument refetch no longer makes the next argument's region look stale.
