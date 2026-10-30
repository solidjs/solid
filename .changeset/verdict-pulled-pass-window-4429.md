---
"@solidjs/signals": patch
---

A memo pulled inside `isPending()` or `latest()` now computes as its own pass (A31): the window's state no longer leaks into it, so a `latest()` it calls doesn't join the hold through the probe, its reads don't answer the outer `isPending`, and its own `isPending` isn't read as inside the outer `latest` (#4429).
