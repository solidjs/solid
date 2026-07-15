---
"@solidjs/signals": patch
---

Fix `affects(store)` as an action's first statement never lighting tracked `isPending` probes (#2887). The mark pokes the node's verdict companion while the owner is still lane-less, so the companion's optimistic lane was born parentless and the action's first optimistic write merged it into the async-carrying lane, deferring every tracked reader of the verdict to settle. Owner lane creation now adopts a companion's own unmerged, parentless lane as a child, making the parent-child relation a property of the nodes rather than of write order.
