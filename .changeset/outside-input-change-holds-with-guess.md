---
"@solidjs/signals": patch
---

An input changed outside an optimistic guess's action no longer tears the screen (#4336). When a `createOptimistic` or `createOptimisticStore` guess made in a pending action (a post's `mine (sending)` over `sel() = 3`) re-asks because a plain write changed its input (`setSel(1)`), the write is held with that action (D-34): the screen keeps `#3: dana | mine (sending)` until the action commits, then shows `#1: ...` with its answer as one frame, whether the reads share one render effect or are split across several. `isPending` is true while the new question is in flight or held, including through the action's own `refresh()`; `latest()` answers the newest truth. A `refresh()` of the same question still keeps its own frame. Also fixed: a held write read in the same flush before the action's first lane read no longer shows before the commit.
