---
"@solidjs/signals": patch
---

An optimistic add or delete on a store now survives its only structural observer leaving: the key's presence node was released with the membership override on it, so `in`, `Object.keys` and property descriptors fell back to the committed structure while the action was still live. The release now waits for the flush that resolves the override, as the value slot's does.
