---
"@solidjs/signals": patch
---

Root owners now carry their lifecycle flags slot from creation. `disposeChildren` marks death by writing `_flags` on every owner it tears down, and the root literal (every `createRoot`, every `mapArray` row and cell owner) did not declare the field, so the first write was a shape transition plus a properties-store allocation per root. On a 100×4 keyed table teardown that was 12 KB and most of disposal's time; uibench removeAll drops 64–70%, the sparse filters 33–61%, single-row removes 40–65%.
