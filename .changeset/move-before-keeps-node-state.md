---
"@solidjs/web": patch
---

The focused node keeps focus when the runtime moves it, where the browser has `Element.moveBefore()` (#3997). List reconciliation moves the node that holds `document.activeElement` with `moveBefore()`, so a focused row survives a reorder, and a move into a list that updates before the one it leaves. While focus is in the list, the reconcile's `replaceChild` path inserts instead, leaving the old row in place until the pass places it. Focus is read once per pass, and not at all without `moveBefore()` or with focus on the body; every other node keeps plain `insertBefore()`, so reorders cost the same as before. Browsers without `moveBefore()` behave as before, with no focus restore. Array inserts into an empty slot now go through the same reconcile.
