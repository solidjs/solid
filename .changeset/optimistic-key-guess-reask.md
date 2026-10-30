---
"@solidjs/signals": patch
---

A per-key guess on `createOptimisticStore` stays on screen through a re-ask that lands while its action is pending (D-34, #4329). When the derive writes a keyed list through its draft (`d.length = 0; d.push(...rows)`, or `d.issues = rows`) under a row that carries a guess, the new object at that row's slot is reconciled into the guessed row, as a returned landing is: the row keeps its proxy and the screen shows the guess until the action commits.

On both landing paths, a guessed key is judged against its guess, so `latest()` answers the truth even when the truth equals the value the guess covered. A correction or confirmation no longer joins the whole landing to the guess's hold. When one re-ask answers guesses from two actions, they stay independent (D-33): each row reverts or commits when its own action settles, and rows with no guess show their new truth at the landing.
