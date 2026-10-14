---
"@solidjs/signals": patch
---

A Loading boundary re-armed by `on` owns the content under it that reads a hold another change made (D-14, D-16, U-9). Before, that content joined the hold, so no fallback showed and the boundary reported pending, and a held tree under a re-armed boundary could redraw forever. Now the fallback shows with the re-arming change and the content reveals at the hold's commit, which no longer waits for it. A re-arm whose own change joins that hold still shows no fallback (the frame waits on the same data), and `LOADING_ON_OUTSIDE_HOLD` is reported only for a flight the change itself started.
