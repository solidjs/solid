---
"@solidjs/web": patch
---

The focused node keeps focus when the runtime moves it, where the browser has `Element.moveBefore()` (#3997). List reconciliation and array inserts move the node that holds `document.activeElement` with `moveBefore()`, so a focused row survives a reorder, and a move into a list that updates before the one it leaves. The reconcile's `replaceChild` path no longer detaches a row it places again later in the same pass while focus is in the list: that row waits at the end of the list's region until its turn. Every other node keeps plain `insertBefore()`, so reorders cost the same as before. Browsers without `moveBefore()` behave as before, with no focus restore, and `moveBefore()`'s extra preconditions (another document, a detached parent) fall back to `insertBefore()`.
