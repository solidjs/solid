---
"@solidjs/signals": patch
---

A store no longer loses later writes after a batch that writes a nested key and then reconciles its parent. The parent's fold took the full-key path and deleted the `$OWNER` stamp from the committed clone that the child's path copy had just created, so later draft writes went to a second target: `snapshot()` saw them, but proxy reads and subscribers stayed on the old value. `foldTarget` now skips `$OWNER` in both full-key loops.
