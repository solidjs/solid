---
"@solidjs/web": patch
---

Frames morph: when a text hole empties, the reconcile drops the stale text node instead of relocating the next element in front of it, so the elements after an emptied text hole stay put instead of being re-inserted.
