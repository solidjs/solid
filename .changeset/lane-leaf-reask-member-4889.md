---
"@solidjs/signals": patch
---

fix(signals): a render effect in one lane reads another lane's member that waits only on `refresh()` re-asks as the screen, so its own guess shows (#4889)
