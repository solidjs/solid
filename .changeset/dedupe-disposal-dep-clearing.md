---
"@solidjs/signals": patch
---

Byte-shave on the disposal path to offset #3029/#3030 landing on always-retained code: the disposeChildren child loop drops its redundant in-heap gate (deleteFromHeap self-guards) and shares a clearDeps() helper with unobserved() for dep unlinking. No behavior change; restores the simple-app 10 kB floor and the isPending/latest budget.
