---
"@solidjs/signals": patch
---

A memo pulled inside `latest()` now computes as its own pass (A31): an `isPending()` it calls answers for what it reads, so a held write still in flight reads as pending there as it does when a plain read pulls the memo (D-23).
