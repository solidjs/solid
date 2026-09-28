---
"@solidjs/signals": patch
---

A full flush pass now counts nodes the finalize staged in the ambient batch as scheduled work, matching the fast drain and the park exit. A woken parked transaction is therefore never re-entered over a staged node with no subscriber (an optimistic store settle's keyset bump under a length-only reader); before, the wake adopted and stamped that node, and a later ambient optimistic write to it joined the parked transaction and its override never reverted.
