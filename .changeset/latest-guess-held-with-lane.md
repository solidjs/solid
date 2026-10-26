---
"@solidjs/signals": patch
---

`latest(x)` of an optimistic guess is held with the guess's lane (#4284). While the lane is blocked on a derivation of the guess still in flight, a render effect reading only `latest(guess)` keeps what it showed, as a plain `guess()` read does, and reveals with the lane, instead of showing the guess beside the held content. What the screen shows no longer depends on how JSX splits holes into effects (F-6: `latest()` escapes the hold, not its own lane).
