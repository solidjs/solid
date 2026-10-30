---
"@solidjs/signals": patch
---

A signal written and written back to its committed value in one tick (D-8, #4452) is no longer read as a staged value by a labelled `untrack` read in dev, which took the slow read path and held what prod did not. The reader-seat shadow's table gains the `D1''` / `L1''` / `V3''` rows for that read (test-only), clearing the `INV-seat-3` "world after the read" classes on `next` (8 in the signals suite, 7 in web, 60 in the generator).
