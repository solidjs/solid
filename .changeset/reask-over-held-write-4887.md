---
"@solidjs/signals": patch
---

fix(signals): a `refresh()` over another action's held write is a re-ask, so a later guess shows to the readers waiting on it (#4887, #4888)
