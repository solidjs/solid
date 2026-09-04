---
"@solidjs/signals": patch
---

Suspend uninitialized async values across optimistic lanes so `latest()`-conditioned branches wait for their first value instead of rendering `undefined`.
