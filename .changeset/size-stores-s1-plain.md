---
"@solidjs/signals": patch
---

Stores on L2, S1: plain `createStore` returns (`snapshot`, `deep`, `storePath`, `isWrappable`, `markRaw`, `$TRACK`/`$TARGET`/`$PROXY`/`$RECORD`, `storeIsShallow`). A store is a tree of L2 nodes: one-literal slot nodes (`slotSignal`) for leaves, presence, deep witness and the container node — the `$TRACK` node given a value, whose staging is the pending backing, so the scheduler owns the backing's lifetime. Core: the slot-node sweep dispatch and the store commit hook; `_devWindows` becomes an observe-literal slot; `mapArray` reads `$TRACK` again. Derived stores, projections, reconcile and optimistic stores return on later steps.
