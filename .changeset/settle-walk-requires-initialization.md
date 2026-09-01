---
"@solidjs/signals": patch
---

Require initialization for the recompute-side settle walk (#3181 follow-up). The walk compensates for a preempted landing, and a landing means truth exists — a node that leaves STATUS_PENDING while still STATUS_UNINITIALIZED (a projection driver whose first flight was superseded before any commit reached the observable store) has nothing to reveal. Waking parked readers there served them the projection's initial face: undefined data a read layer had promised was settled, which threw in unguarded reads and halted the reactive system (observed as the TanStack Query adapter's first loads wedging at their loading boundary on rc.5).
