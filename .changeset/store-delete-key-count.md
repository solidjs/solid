---
"@solidjs/signals": patch
---

Deleting a store key now decrements the store's key count. The count went up on every added key but came down only in the overlay rebuild paths, so the natural keyed-selection shape — delete the previous key, set the new one — drifted it upward by one per write until a small object crossed the overlay threshold and paid a full rebuild of its backing on every commit after. A delete of a draft's own key (a plain clone's, or an overlay's own add) is counted immediately; an overlay's delete of a committed key is still recorded and counted at the rebuild.
