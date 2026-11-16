---
"@solidjs/signals": patch
---

`<Loading on={key}>` keeps its fallback when an action's optimistic guess re-derives content from a flight the key re-asked (#4927). Lane work served the flight's committed value keeps the node's pending (#4862). Two gaps let the fallback lift early and show the old key's content under the new heading:

- A derived store's pass settled its property readers on its own, even though core kept the derive pending. The family now settles only when core does.
- The served record was one global. A nested computation that ran inside the outer pass (a memo created or pulled mid-body) overwrote it, so the outer pass cleared its pending. The record is now kept per node.
