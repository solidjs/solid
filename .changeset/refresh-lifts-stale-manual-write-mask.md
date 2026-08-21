---
"@solidjs/signals": patch
---

Fix `refresh(store)` being silently swallowed inside an `action()` after a `setStore` in the same transaction (#3026). The derived-store manual-write mask (which lets a same-tick manual write win over a queued recompute, #2692) previously persisted for the whole transaction, so any setStore early in an action made every later `refresh()` a no-op. An explicit `refresh()` now lifts a mask stamped in an earlier tick and re-runs the source; a manual write in the same synchronous tick still wins in both orders, preserving the #2692 contract.
