---
"@solidjs/signals": patch
---

Mounting N rows in one flush was O(N²) when each row created a user effect whose source was written during row creation (the `ref` effect pattern). An unmarked node entering an already-marked pure heap invalidated the `markHeap` memo, so every later mid-tick memo pull re-walked the whole heap. The insertion now marks the incoming node in place instead; the mount is linear (8000 rows with a ref effect each: 231 ms → 12 ms).
