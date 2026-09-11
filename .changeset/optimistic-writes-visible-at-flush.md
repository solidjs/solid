---
"@solidjs/signals": patch
---

Optimistic writes become visible at flush (A28 for overrides). `setOptimistic(x)` / an optimistic store setter no longer installs the override synchronously: the write parks on the node and becomes the active override when the flush carries it, so plain reads, `snapshot()` and `isPending()` answer the flushed value until then — the same rule every other write follows, and the same visibility React's `useOptimistic` gives. An ambient optimistic write (no action in flight) is shown by its flush to effects and reverted at the flush's end. The setter's functional updater, a store setter's draft, and the `affects()` declaration walk still compose on the tick's own earlier writes (two `count++` are +2; a toggle toggled back cancels; `affects(parent)` after a push covers the pushed row). To mark a single slot of a row you are adding, call `affects` on the draft row inside the setter — the row is not readable through the store until the flush.
