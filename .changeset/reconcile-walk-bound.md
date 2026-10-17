---
"@solidjs/web": patch
---

The keyed reconciler's common-prefix and common-suffix walks no longer check each node's liveness and slot ownership; the suffix walk is bounded to the open range instead. Inside that range this pass never detaches a node, and the one case the per-node check guarded against (#574: an unbounded suffix walk reaching back to a node a replace had already taken out while it was still pending) cannot happen once the walk stops at the range. Every anchor read and destructive operation keeps its ownership gate, so migrated and foreign nodes are still left alone. A 1000-row swap drops from about 30 to 25 µs, and the uibench long-walk reorder and remove-all cases by 10 to 17%.
