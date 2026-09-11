---
"@solidjs/signals": patch
---

Optimistic writes become visible at flush (A28 for overrides). `setOptimistic(x)` / an optimistic store setter no longer installs the override synchronously: the write parks on the node and becomes the active override when the flush carries it, so plain reads, `snapshot()`, `isPending()` and `affects()` all answer the flushed value until then — the same rule every other write follows, and the same visibility React's `useOptimistic` gives. An ambient optimistic write (no action in flight) is shown by its flush to effects and reverted at the flush's end. The setter's functional updater and a store setter's draft still compose on the tick's own earlier writes (two `count++` are +2; a toggle toggled back cancels). To mark a row you are adding as pending, call `affects` on the draft row inside the setter.
