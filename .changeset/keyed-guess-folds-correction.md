---
"@solidjs/signals": patch
---

A keyed optimistic store's arrangement guess is no longer voided when the source answers with something different while the guess's action is open: the answer folds beneath it until the hold commits, and rows then match by key. Two overlapping actions on one list used to leave the store torn after the first one's echo (a hole at its index, `length` from the guess, a raw target served for a row), and the confirmed row remounted twice at the commit, taking an open editor and its draft with it. Now the screen keeps both guesses whole, nothing remounts, and a row another tab added shows when the write settles. Memos and effects outside the optimistic lane still derive from the answer right away and are held with it, and `latest()` shows it.
