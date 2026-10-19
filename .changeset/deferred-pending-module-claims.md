---
"solid-js": patch
---

Retain deferred hydration claims while client-only module imports are pending, including nested Loading boundaries, rejected imports and error fallbacks, so hydration reuses the original server nodes and completes when their claims settle or retire.
