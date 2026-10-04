---
"@solidjs/signals": patch
---

Store size pass after S4: the write override is a live binding (no accessor call on the `get` hot path); the optimistic draft and its set-aside staging live in the optimistic module; one predicate for the lane-view composition sites. Behavior unchanged.
