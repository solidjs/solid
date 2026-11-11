---
"@solidjs/signals": patch
---

`onFlush` callbacks now each run in their own flush. Before, several callbacks queued in one frame batched into a single flush, so async work one of them started held the others' writes with it. Each callback is now its own frame (D-4): it commits on its own unless what it changes derives from held work.
