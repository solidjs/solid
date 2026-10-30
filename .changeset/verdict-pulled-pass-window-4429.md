---
"@solidjs/signals": patch
---

A memo pulled inside `isPending()` now computes as its own pass (A31): the probe's state no longer leaks into it, so a `latest()` it calls doesn't join the hold through the probe, and its reads don't answer the outer `isPending` (#4429).
