---
"@solidjs/signals": patch
---

Two ways a held write stayed staged past the point it should have revealed:

- A transaction whose only reporter is disposed by ambient work (a `<Show>` unmounting the reader of a pending memo) was never re-judged — the flush only evaluates the active transaction, and nothing re-entered a parked one. The writes held with that reader (a signal set while it was pending) stayed staged forever. Disposing a pending reader parked in a transaction now wakes it; the flush re-enters a woken transaction on an otherwise idle pass, prunes the dead reporter and commits (#3372).
- An effect that reads `latest()` (or otherwise adopts an optimistic lane through its deps) direct-commits on a lane pass, but a hold it had staged on an earlier, lane-free pass of the same transaction was left in place and the transaction's commit published that older frame over the fresh value — `Pair: 0 / 0` for good. A lane recompute now drops the hold it supersedes, override or not (#3377).
