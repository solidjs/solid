---
"@solidjs/signals": patch
---

A value read for the first time behind an `isPending(...)` check in a binding that is already on screen updates while the fetch is in flight, as it does when it is read before the check (#4966). Only a value read ahead (`latest`) opens a mount that waits for the landing (#4806).
