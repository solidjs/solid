---
"@solidjs/signals": patch
---

A memo's error staged with a hold now reaches the memos and derived stores that derive from it: `latest()` of them throws the proposed error and `isPending()` of them is `true` until the hold commits, as for the memo itself (D-41).
