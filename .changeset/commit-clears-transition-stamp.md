---
"@solidjs/signals": patch
---

Clear a node's transition stamp when its pending value commits. `_transition`
was only ever cleared for optimistic nodes and in one async settle;
everything else relied on `reassignPendingTransition`, which the completing
branch runs over `batch._pendingNodes`. `commitPendingNodes` drains that list
without clearing anything, so a node committed by an earlier drain kept
pointing at a transition that later finished. `setSignal` re-enters
`el._transition` before it discovers a write changes nothing, and a loading
boundary rewrites the same flag on every drain pass, so a finished transition
was re-armed forever and `flush()` never ended: dev threw "Potential Infinite
Loop Detected", production has no counter on that loop and hung. The
re-entered transition also aliases the ambient batch's containers, so
`initTransition`'s adoption pass could push into the array it was iterating
until `RangeError: Invalid array length`.
