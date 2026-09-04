---
"@solidjs/signals": patch
---

Merge clone-path folds onto a container privatized mid-batch (#3271). Family and array drafts fold by swapping their pending backing in and re-slotting the parent with a CAS against the pre-batch old. When a descendant of the same node was written earlier in the draft, the descendant's fold path-copies THROUGH the ancestor first — privatizeCommitted clones the ancestor's committed backing and re-points the parent slot at the clone — so the ancestor's own fold swapped in a stale ensurePB-time clone, failed the parent CAS, and its writes were silently discarded (writable projections; plain object stores fold through the overlay path and were immune). Such folds now merge the batch's written keys onto the privatized container in place — the trap's written-keys bound is authoritative, with a value-diff fallback when an array length write poisoned it — composing both folds instead of losing one.
