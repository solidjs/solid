---
"@solidjs/signals": patch
---

A fresh `Loading` mounted over a held value shows its fallback in a flush too (#3540 under L2): a first pass a loading boundary that has not shown content catches is the boundary's, not the tick's, so the mount publishes and the content reveals at the commit. Content bound by a render effect under the boundary is collected, so the boundary no longer reveals empty content.
