---
"@solidjs/signals": patch
---

A per-key guess on `createOptimisticStore` stays on screen through a re-ask that lands while its action is pending (D-34, #4329). When the derive writes a keyed list through its draft (`d.length = 0; d.push(...rows)`, or `d.issues = rows`) under a row that carries a guess, the new object with that row's key is adopted by the guessed row, as a returned or reconciled landing already does: the row keeps its proxy, the guess stays over the new truth, and the screen shows the guess until the action commits. Guesses on different rows stay independent (D-33).
