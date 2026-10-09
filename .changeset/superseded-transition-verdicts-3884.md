---
"@solidjs/signals": patch
---

isPending and latest on a superseded write do not depend on reads inside the parked computation.
