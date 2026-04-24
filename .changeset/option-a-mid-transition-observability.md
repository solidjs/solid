---
"solid-js": patch
---

Fix mid-transition observability of mixed optimistic and entangled state. Subscribers recomputing under an optimistic lane that read a plain signal with a pending mid-transition write now see the signal's committed value (entangled), while optimistic overrides still project their optimistic value. Async drivers continue to read latest values for correct fetching. At commit, gated subscribers re-run with the new committed view.
