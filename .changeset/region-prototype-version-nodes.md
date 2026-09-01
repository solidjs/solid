---
"@solidjs/signals": patch
---

Graph-native region prototype (exploration branch): lazy per-record version signals written through the store's normal write path, a detached `deliveryEffect` render primitive, and a `regionBind` helper — regions subscribe to one node per record and read raw in their commit, with all delivery timing owned by the scheduler. Prototype surface, not product API.
