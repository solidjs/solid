---
"@solidjs/signals": patch
---

Route synchronous throws from the async iterator / thenable protocol (a later `next()`, a step's `then`, or deferred iterator setup) to the owning memo's error handling instead of escaping as unhandled rejections, and make `StatusError` message formatting best-effort so it never replaces the original error (#4112).
