---
"@solidjs/signals": patch
"solid-js": patch
---

A loading boundary that has not shown content — or that an `on` change has re-armed — owns its subtree (#3540 under L2). Content under it that reads a held value or waits on its first loads is pending: the boundary shows its fallback, no hold waits for it, and it re-derives at the hold's commit. A fresh `Loading` mounted over a held value shows its fallback in a flush too, and content bound by a render effect under it no longer reveals empty. Committed content under an `on`-re-armed boundary that reads a value held by another change now waits behind the fallback instead of holding the change. A boundary mounted as part of a hold still appears at that hold's commit, and outside such a boundary nothing changes. DEV's `LOADING_ON_OUTSIDE_HOLD` reports only a re-arm whose fallback is actually held; the `Loading` `on` docs say which data holds the change.
