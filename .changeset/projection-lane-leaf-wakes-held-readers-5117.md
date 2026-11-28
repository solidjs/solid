---
"@solidjs/signals": patch
---

A projection or derived store that re-derives as an action's optimistic lane work now re-runs a reader in a branch the action is closing, as a memo's lane pass does. Before, that reader kept the old value while a reader outside the branch showed the guess in the same frame (#5117).
