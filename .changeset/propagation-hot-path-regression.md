---
"@solidjs/signals": patch
---

Staged-rewrite fast path plus propagation hot-path recovery. A re-write to an already-staged signal now skips the idempotent subscriber walk (a global notify epoch — bumped by every recompute and new link — keeps the skip sound against mid-batch pulls): clean-machine medians show diamond propagation +119%, avoidable chains +52%, and repeated single-signal fanout writes (update1to1000) 91x. markNode gates its firewall-children walk on CONFIG_FW_CHILDREN, setSignal reads the extension once, and _transition returns to the core literal. Remaining characterized trade from the earlier shape-alignment increment: single-write update1to1 -10%, create0to1 -5% — tracked for CodSpeed adjudication against the wins above and the -22% per-memo memory of the extension split.
