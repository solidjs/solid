---
"@solidjs/signals": patch
---

A derivation re-running under a lane whose first pass was equal receives its committed value as `prev` instead of the empty `NOT_PENDING` marker.
