---
"@solidjs/signals": patch
---

`createOptimisticStore(fn)` delivers the error of an upstream memo its derive reads, as `createStore(fn)` does: the optimistic store now builds its family through the projection's own constructor.
