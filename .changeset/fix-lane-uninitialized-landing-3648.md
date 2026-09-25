---
"@solidjs/signals": patch
---

fix(signals): first async landing under an optimistic lane (#3648). A memo whose first result lands while it is a member of an optimistic lane publishes as a derived override with `_value` never committed. The `settlePendingSource` invariant no longer reports `SETTLE_WALK_UNINITIALIZED_SOURCE` for that landing (the displayed derived override is its truth) and, when it does fire, prints its message rather than only the repair-guide footer. An off-lane render reader of such a never-committed node now suspends (`NotReadyError`) instead of being served a fabricated `undefined`. An `untrack(() => isPending(x))` inside a memo no longer enrolls the memo as a suppressed probe, so the router's `query()` flight is no longer duplicated by the lane wake.
