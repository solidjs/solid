---
"@solidjs/signals": patch
---

A long memo chain over an async source no longer overflows the stack when its flight goes pending, settles or rejects (#4587). The status propagation (`notifyStatus` → `propagateStatus`), the dependent walk shared by the settle and error sweeps (`walkDependents`) and the staged-error marking (`stageMark` → `settlePendingSource`) recursed once per chain node. The two walks now share one walker that reaches a node's last dependent by its loop rather than a call — the order recursion gave, with no allocation — and a marked node's settle walk runs from the first mark's loop. A rejection reaches the `Errored` boundary as its own error at any depth, and no frame is dropped.
