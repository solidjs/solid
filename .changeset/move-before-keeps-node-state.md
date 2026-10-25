---
"@solidjs/web": patch
---

A node the runtime moves keeps its state where the browser has `Element.moveBefore()` (#3997). List reconciliation and array inserts move a node that is already in the document with `moveBefore()`, so state tied to its place in the document survives a reorder, and a move into a list that updates first: focus (measured in Chromium), and per the spec CSS animations and transitions, iframes and popover state. The reconcile no longer detaches a row it places again later in the same pass (the `replaceChild` path when a row moves toward the end); with `moveBefore()` that row waits at the end of the list's region until its turn. Browsers without `moveBefore()` behave as before, and `moveBefore()`'s extra preconditions (another document, a detached parent) fall back to `insertBefore()`. A custom element moved this way gets `connectedMoveCallback` if it defines one, otherwise its disconnected and connected callbacks as before.
