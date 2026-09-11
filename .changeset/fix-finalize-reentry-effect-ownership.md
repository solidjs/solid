---
"@solidjs/signals": patch
---

Fix a held transaction being re-entered while an unrelated flush finalizes — through a store commit hook (`deep()` readers of a projection), a boundary check, or a recompute — and that flush then committing the transaction's state and running its effects as if it still owned the batch, leaving the UI permanently stale once the transaction settled (#3319). Finalization now captures the batch it started with and settles nothing an entered transaction adopted (a completing transaction still settles its own separate containers). Effects follow ownership: a run is applied by the commit of the transaction that computed its value, so the entering flush still applies everything it computed mainline — the write that caused it reads and renders together — while runs owned by the still-held transaction park with it and release when it completes. Optimistic lanes are unaffected; they apply their own effects ahead of their transaction by design.
