---
"@solidjs/signals": patch
---

Owner disposal is now death for every node it reaches: reads after teardown return the last committed value instead of re-running the source function. Previously a post-disposal read re-derived the node — re-running user code against the torn-down tree, discarding manual writes on derived-writable signals (`createSignal(fn)`, #3024), and re-firing async work with no owner. The disposal walk now strips the observation lifecycle (`AUTO_DISPOSE`) from everything it disposes, including lazy memos and already-dormant children, so nothing owned can reawaken after its owner is gone. Dormancy is unchanged where it is the contract: an unowned/lazy memo released by `unobserved()` when its last subscriber leaves still recomputes fresh on the next read.
