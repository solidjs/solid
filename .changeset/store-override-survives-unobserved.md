---
"@solidjs/signals": patch
---

An optimistic store override now survives its key becoming unobserved. The property node was released with the override on it the moment its last reader left, so an untracked read of the key (`s.n`) returned the committed value while the action was still live; the release now waits for the flush that resolves the override, as an optimistic signal keeps its override whether or not anything reads it.
