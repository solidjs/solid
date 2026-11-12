---
"@solidjs/web": patch
---

The DOM list reconciler no longer throws `NotFoundError` when user code moved a list node past the end of its list and the same update removes or replaces that node. The append step used the node after the list as its anchor even after the pass had taken it out of the parent; it now falls back to the marker, or the end of the parent.
