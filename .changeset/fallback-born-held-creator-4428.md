---
"@solidjs/signals": patch
---

A `Loading`/`Errored` fallback is born held only when the boundary's output pass that builds it read the hold (D-27), no longer by the flag of the enclosing pass it is parented under (#4428).
