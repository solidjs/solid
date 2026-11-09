---
"@solidjs/signals": patch
---

`deep()` and `snapshot()` read inside a computation now serve the frame the store's container node serves that computation. Before, a container held by a transaction (an action that wrote the store on both sides of a yield) always served its committed backing to `deep()`/`snapshot()`, even in the transaction's own landing flush, where the same computation's property reads already saw the landed values: a render effect reading `s.x` and `deep(s)` logged `3:{"x":1}` and was never re-run. The same applied to a derived `createStore(fn, seed)` whose user setter wrote across a yield. Reads outside a computation still see the committed backing of a held container.
