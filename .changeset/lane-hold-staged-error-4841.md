---
"@solidjs/signals": patch
---

A guess lane no longer shows an error that another action still holds. `<Errored>` waits for the hold, as it does when nothing reads a guess, instead of flipping early and then recovering over the previous question's answer (#4841).
