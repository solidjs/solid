---
"@solidjs/signals": patch
---

Keep traversing sibling effect queues when a child queue removes itself or an earlier sibling during a flush. Previously, the shifted sibling could be skipped and leave its queued effects unexecuted.
