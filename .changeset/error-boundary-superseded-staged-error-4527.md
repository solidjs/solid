---
"@solidjs/signals": patch
---

An error boundary no longer hands its reader an error that was superseded inside the same transition (#4527). Here is the case: an action keeps its transition open, the store's re-ask is rejected (that rejection is staged, D-41), and a second re-ask answers before the commit. An effect whose compute created `createErrorBoundary(() => store, …)` used to get the fallback at the commit and never ran again. Now it gets the answer, as the screen does.

Two changes make that work. First, a pass that a derived store's pull throws a staged error into is now linked to the store's derive, including the untracked shape probe of a returned proxy. That way the re-ask and the answer that supersede the error reach the memo. Second, an error boundary no longer waits for first content: one that has not shown content reveals a recovery that lands in the hold it caught the error in together with that hold's commit, instead of keeping its fallback past it.
