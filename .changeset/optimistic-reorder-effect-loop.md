---
"@solidjs/signals": patch
---

An effect reading every row of an optimistic store no longer spins `flush` forever when the source's answer moves the optimistically written row to an earlier index (#4014). The lane seam re-enqueued the leaked effect as a mainline re-derivation, so its first held read joined the parked transaction and was served the staging, and its later read of the written value re-entered the lane and leaked again, every round. A leaked reader of a lane is now re-seated in that lane, as a computed already is, and reads the held slots as committed.
