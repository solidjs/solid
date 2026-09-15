---
"@solidjs/signals": patch
---

Two flights through one memo settle as one unit, and a branch a held `Show` is removing keeps following `latest()` (#3443, #3444).

- A memo another live transaction holds, made pending by a second flight, entangles the two at the propagation (#3443). The second flight only propagated pending onto the memo — no recompute, its inputs' values were unchanged — so the memo's stamped re-entry never ran and the first transaction never learned it was waiting: it revealed `A: 1` beside the committed `Sum: 0`, and `Sum: 2` arrived with `B: 1`. Now one reveal when both have landed (A15). A render effect reading both plainly stays parallel, as before; a write whose async work flows into a held memo is held with it.
- A zombie dirtied through the lane channel runs instead of being cancelled (#3444). When the parking batch is the transaction, queued zombie recomputes are cancelled as a world the zombie never displays — but overrides and `latest()` companions are the mainline frame, and the still-visible branch showed `latest(count)` at 0 beside the same read outside at 1.
