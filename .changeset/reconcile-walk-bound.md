---
"@solidjs/web": patch
---

The keyed reconciler is back on the slot-ownership design from May: the common-prefix and common-suffix walks match by identity, with no per-node liveness check. #574 — a node dropped after a replace plus an end-swap — is fixed at its cause instead: the suffix walk is bounded to the open range, so it can no longer reach back into entries the pass already consumed. The append branch anchors on a node the slot still owns, so a node user code moved away cannot make an insert throw. In the map branch, an old node that is no longer ours is consumed rather than "replaced" by an insert at the region's end, so the changed window lands in list order around a moved-away node. A node moved away that sits in the unchanged prefix or suffix stays where it was moved, as it did before the #574 patch. A 1000-row swap drops from about 30 to 25 µs; long reorders and memo-wall's one-change update 10–50%.
