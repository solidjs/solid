---
"@solidjs/signals": patch
---

A structural store write during hydration's snapshot capture (a row removed from an array from `onSettled`, by `splice` or `reconcile`) records the container's pre-write backing as its snapshot, the way a leaf write already does. Readers inside the snapshot scope, such as a hydrated `<For>`, are held on the server's list until the scope is released instead of re-running mid-claim against a snapshot `length` and live items, which rendered a row for `undefined`, threw, and halted reactivity (#3950).
