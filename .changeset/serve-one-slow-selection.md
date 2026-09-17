---
"@solidjs/signals": patch
---

One slow value selection, `serve`, for signal reads and store property nodes (the fast paths keep their inline ternary). Fixes a derivation's untracked read of a derived optimistic store's key after its own truth landed differently from the optimistic edit: the store served the memo the superseded override and let it publish, where a signal serves the landed truth and holds the memo with the action (A18).
