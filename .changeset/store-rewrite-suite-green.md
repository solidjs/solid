---
"@solidjs/signals": minor
---

Store rewrite: full suite green. Optimistic array length is a view of the
composed membership (tear-free iteration by construction), landing consumption
folds committed values into nodes directly (no stranded wakes behind parked
transactions), and `$TRACK` on chained store views reads through to the inner
store's key-set node so keyed iteration observes structural changes at the
source (#2864).
