---
"@solidjs/signals": patch
---

A waiting action started from a cleanup, with nothing staged, no longer holds the work the same drain runs after the landing that ran the cleanup: an effect's write reacting to the landed values, or a corrected guess's reveal (#5257).
