---
"solid-js": patch
---

Release disposed transition sources during a pending Suspense transition so keyed store reconciles cannot retain unbounded memory.
