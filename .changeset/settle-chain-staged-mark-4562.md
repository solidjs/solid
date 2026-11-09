---
"@solidjs/signals": patch
---

A chain's verdict no longer flips to `false` mid-hold where a diamond's stays `true` (#4562). When a superseded flight's error is staged in a hold (D-41), the settle walk now marks every derivation it fully settles with the staging, not only a join it reaches a second time, so `isPending` stays `true` until the commit whatever the graph shape (F-9, F-2). The mark moved behind the verdict engine's hooks (`installVerdictHooks`), so builds without `isPending`/`latest` carry none of it.
