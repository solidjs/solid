---
"@solidjs/signals": patch
---

A guessed node now stores two values, and its lane stores at most one more: `_value` is always what the screen shows, `_pendingValue` is what the hold will commit (the value the guess reverts to, staged when the guess is revealed, or a truth that landed beneath it), and the lane's record holds only a guess it has not revealed yet. The covered value kept beside a guess and beside lane derivations is gone, and so is the note of what the screen showed while a second guess on a shown guess waited (#4775): the screen's value is no longer written before the reveal. No rule or screen changes.
