---
"@solidjs/signals": patch
---

After a list's re-ask fails while other re-asks are out, a fresh guess on one of its rows now shows in the `For` row as it does in a memo over the same row (#5095). More generally, a reader that is only waiting on a `refresh()` now follows an optimistic write it reads, whatever kind of reader it is; a reader waiting on a new question still stays with the change that asked it.
