---
"@solidjs/signals": patch
---

Fix a deadlock where a boundary-caught first load settled back into an incomplete action transaction (#2937). The loading rail is invisible to transactions: an uninitialized async that never registered as a transition reporter now drops its stale transition stamp at settle instead of re-entering the transaction, so the boundary's fallback-to-content reveal (and its onCleanup) flows ambiently. Same-tick writes before an action call — plain or optimistic — still join the transaction; escaped (unboundaried) first loads keep transition scheduling.
