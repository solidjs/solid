---
"@solidjs/signals": patch
---

Patch-channel held emissions stash directly on their transition object
instead of a WeakMap — the every-flush commit-hook check becomes one
property read, and reverted transitions drop their stash with the object
