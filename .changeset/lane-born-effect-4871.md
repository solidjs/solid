---
"@solidjs/signals": patch
---

fix(signals): a render effect born in a lane pass is not marked uninitialized, so the flush no longer loops after a re-ask lands with several guesses out (#4871, regression from #4865)
