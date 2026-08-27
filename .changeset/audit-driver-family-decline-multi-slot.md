---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

External-audit fixes on the patch-list driver surface: family (projection/optimistic) arrays now decline the driver — their structural changes emit no row/slot ops and the proxy identity is stable, so an engaged list would freeze on optimistic or projection structure (classic mapArray handles them correctly, including on identity-swap handoff). Shallow slot-patch registration is now multi-consumer — two driven lists over one shallow array previously overwrote each other's channel. Adds `storeHasFamily` (with server stub) and regression tests for both.
