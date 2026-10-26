---
"@solidjs/signals": patch
---

A derived store's per-key `isPending` now reads `true` while the derive re-asks under a `Loading` boundary that has shown content, when the verdict is read in the same computation as the value (`${state.a} ${isPending(() => state.a)}`). The derive's first flight left a commit-beneath-a-flight mark that its setter landing never cleared, so the next re-ask suspended the verdict reader to the boundary (which kept the stale screen with `isPending` false) instead of serving it the committed value with `isPending` true, as an async memo does. (#4269)
