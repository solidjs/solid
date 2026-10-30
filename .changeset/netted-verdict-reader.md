---
"@solidjs/signals": patch
---

Writes that net to a signal's committed value in the tick an action opens a hold no longer pend the signal: a render effect reading `isPending(s)` shows `false` during the hold and is not re-run when the action lands (D-8).
