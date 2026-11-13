---
"@solidjs/signals": patch
---

Changing a keyed `<For>` selection while a `createOptimistic` guess its rows read is out no longer loops forever: a binding that reads a guess lane's member while that member's own fetch is up re-derives when the fetch lands, not again at every reveal of the lane (#4840).
