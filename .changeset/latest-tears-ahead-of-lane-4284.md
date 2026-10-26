---
"@solidjs/signals": patch
---

`latest()` of an optimistic value now shows the guess beside the held screen however reads are grouped into render effects (#4284). When a guess's lane is held on a downstream async derivation, a render effect that reads the guess and `latest(guess)` together no longer parks with the lane and freezes the `latest()` read: like split effects, it shows `1 x1 / 5` (the committed value and its derivation beside the guess) and `5 x5 / 5` when the derivation lands. The lane still holds the guess until its derivation lands; an unblocked lane costs no extra pass.
