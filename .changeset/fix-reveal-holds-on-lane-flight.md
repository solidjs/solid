---
"@solidjs/signals": patch
---

A reveal that discovers an async already in flight holds on the flight, whichever transaction the node is stamped with, and completes when the flight lands (#3334; A15 reveal corollary).

- `read()` no longer serves a pending node's committed value to a stale reader just because the node is stamped by another transaction. The stamp is pending-node bookkeeping — the flight's inputs may already be on screen (committed with no observer, #3305; revealed through an optimistic lane, #3334; held only by another reveal waiting on the same flight) — so that value tears the frame. The reader throws, the reveal opens/joins a transition blocked on the flight, and settles as one unit with it.
- Landing a lane-routed async now re-enters the transaction _waiting_ on it (`waitingTransition`) rather than the transaction that owns the lane. Entering the owner made the waiting reveal's stamped recompute merge the owner's still-running action into the reveal, so a `Show` flipped during an optimistic action stayed hidden until the action finished instead of until the data landed.
- `laneHeld` looks the observation up through the same `waitingTransition` helper (#3335).
