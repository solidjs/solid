---
"@solidjs/signals": patch
---

`$TRACK`-only readers of an optimistic array now link the guess carrier, so structural guesses paint and reverts re-run (#5007).
