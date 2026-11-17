---
"@solidjs/signals": patch
---

fix(signals): a memo that reads a projection's own row (handed back into the projection's source) reads it as an input and no longer pulls the projection, so heights stop climbing. That climb left the memo stale after an accepted add (#4970) and threw `RangeError: Invalid array length` after a re-ask (#4972).
