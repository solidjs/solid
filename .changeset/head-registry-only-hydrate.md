---
"@solidjs/web": patch
---

Fix `hydrate(document)` hanging when the head holds only registry-inserted tags. The #3081 prelude move appended each leading `data-dh` tag to the end of the head; with no authored head children the run never ended and rotated the head forever. It now stops after moving the head's original last child.
