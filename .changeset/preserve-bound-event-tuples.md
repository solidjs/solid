---
"@solidjs/web": patch
---

Keep bound handler tuples reusable across non-delegated events by leaving the user-provided tuple unchanged when installing a listener.
