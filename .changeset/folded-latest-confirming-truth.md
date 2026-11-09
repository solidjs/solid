---
"@solidjs/signals": patch
---

A derived store (or memo) reading a keyed optimistic store through `latest()` now picks up a confirmed row after a correction folded the truth beneath the guess: a confirming truth landing re-derives the `latest()` readers too.
