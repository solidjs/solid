---
"@solidjs/signals": patch
---

A settled `refresh()` no longer leaves its waiter reachable. The waiter's read of the held re-ask made it the flush's adopting pass, and the engine kept that pass after the flush ended, along with the hold it read in once that hold had landed and every node the hold listed. When a signal was written in the same tick as the `refresh()`, each waiter of that hold stayed alive. Each flush now releases its adopting pass at its seam.
