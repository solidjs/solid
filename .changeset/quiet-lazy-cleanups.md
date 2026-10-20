---
"@solidjs/signals": patch
---

Restore deferred lazy releases when an unfinished frame's cleanup throws, so later unrelated lazy memos still clean up when their last observer is removed.
