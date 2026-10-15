---
"@solidjs/web": patch
---

Frames morph skips an identical subtree with one native `isEqualNode` compare instead of walking it.
