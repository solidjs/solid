---
"@solidjs/signals": patch
---

A long memo chain over an async source no longer overflows the stack when its flight goes pending, settles or rejects (#4587). The status propagation (`propagateStatus`), the dependent walk shared by the settle and error sweeps (`walkDependents`) and the staged-error marking (`stageMark` → `settlePendingSource`) recursed once per chain node; they now walk with an explicit stack, in the same order. A rejection reaches the `Errored` boundary as its own error at any depth, and no frame is dropped.
