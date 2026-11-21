---
"@solidjs/signals": patch
---

A ref callback reads like an event handler or an effect callback: a pending value that has a committed one serves the committed value instead of throwing `NotReadyError`, and dev no longer opens a strict-read window there (no `STRICT_READ_UNTRACKED` or `PENDING_ASYNC_UNTRACKED_READ` in a ref). A node with no value yet still throws.
