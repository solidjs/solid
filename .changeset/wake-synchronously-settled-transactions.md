---
"@solidjs/signals": patch
---

Fix effect writes remaining held when a pending memo is superseded by a synchronous result equal to its cached value. Recheck parked transactions after the source settles synchronously, since the superseded promise can no longer release them when it resolves.
