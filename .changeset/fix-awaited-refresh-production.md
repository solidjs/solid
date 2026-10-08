---
"@solidjs/signals": patch
---

Fix an awaited `refresh()` never settling in production builds: the waiter is always created under a root, so it re-runs when the refetch lands instead of being released as an unobserved node. `yield refresh(x)` in an action now finishes, and the refetched value reaches the UI.
