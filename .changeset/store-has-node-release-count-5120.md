---
"@solidjs/signals": patch
---

Releasing a store's presence nodes no longer scans the remaining keys on each release, so disposing a reader of a tracked array iteration is linear in the array's length again (#5120).
