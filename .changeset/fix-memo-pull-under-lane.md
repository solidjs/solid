---
"@solidjs/signals": patch
---

A memo computes under its own lane posture, never its puller's (#3442).

A combined `isPending(() => [fast(), copy()])` over two async memos, with `copy` a sync memo wrapping the slow one, released the hold as soon as the fast flight landed: `Fast: 1` beside `Slow: 0` with `Pending: false`, then `Slow: 1` a second later. The probe effect carries the companion lane of the pending signals it reads, and its pull of `copy` ran under that lane — where a pending node on no lane serves its committed value instead of throwing — so `copy` published a stale settled value, dropped its pending status, and its readers stopped holding the slow flight. `recompute` now runs a memo plain unless the memo itself is lane-dirty or adopts a lane through its dependencies; effects keep the ambient lane, since their runs are the lane's own view. Both values now reveal together, with the probe reporting pending until they do.
