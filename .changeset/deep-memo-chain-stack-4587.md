---
"@solidjs/signals": patch
---

A long memo chain over an async source no longer overflows the stack when its flight goes pending, settles or rejects (#4587). The status propagation (`notifyStatus` → `propagateStatus`), the dependent walk shared by the settle and error sweeps (`walkDependents`) and the staged-error marking (`stageMark` → `settlePendingSource`) recursed once per chain node; a dependent's propagation and a marked node's settle walk now run from the outermost call's loop, and the dependent walk queues through its visited set. A rejection reaches the `Errored` boundary as its own error at any depth, and no frame is dropped.
