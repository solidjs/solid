---
"@solidjs/signals": patch
---

A memo or user effect created on mainline whose untracked read (`untrack(() => s.n)`, `deep(s)`) is of a store key held by a live action is now born held (A29), as the same read of a signal is: the pass enters the action's transaction and publishes nothing until the action commits. Previously the store's untracked paths served the held value without entering, so a mainline memo published the action's unrevealed write to the screen. Covers keys with and without a node and `reconcile` adoptions held by an action.
