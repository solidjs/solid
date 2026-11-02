---
"@solidjs/signals": patch
---

A `createTrackedEffect` now re-runs for a same-pass write it reads through a memo (#4606), and for an action's landing when it re-ran during the transition for another dependency (#4607). A memo the run's own read pulls stages its value while the run recomputes, so its subscriber walk woke nobody; the run now re-queues for any memo dependency staged with a different value, as it does for a signal written before the run (#4598). A run during a hold is served the committed value of the held dependency and had consumed the run the landing replays; it now queues one run with that hold's stashed runs, so it re-runs at the landing as a stale reader would (A15), without holding the transaction open (D-29). A tracked effect that writes a signal and then reads a memo of it re-runs once the write commits, as one that reads the memo first already did.
