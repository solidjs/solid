---
"solid-js": patch
---

Retire a completed deferred hydration claim before running user lifecycle callbacks, so signal writes from `onSettled` update the claimed DOM.
