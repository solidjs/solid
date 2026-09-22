---
"@solidjs/signals": patch
---

A lazy memo (`createMemo(fn, { lazy: true })`) that went dormant and was later read again is owned by its root again: the root's `dispose()` tears it down and its siblings are no longer orphaned by the memo's next dormancy (#3554). Reading a dormant lazy memo after its owner has been disposed now returns the last committed value without reviving it.
