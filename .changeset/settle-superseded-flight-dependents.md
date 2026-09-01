---
"@solidjs/signals": patch
---

A pending flight superseded by a synchronous settle now wakes its registered dependents (#3181). When an async source's settle is announced by a signal write in the same synchronous step in which its promise resolves (the cache-backed fetch shape — TanStack Query's adapter), the write recomputes the derive first and the flight lands pre-superseded, so the async landing's settle walk never ran: every dependent that suspended on the flight stayed flagged pending on a source that would never land. A memo over an in-place-reconciling projection was the visible casualty — it recovered to an unchanged value, so nothing re-notified, and readers that suspended through it re-parked on the dead source permanently. `recompute` now captures pending source-hood and runs the settle walk itself when a synchronous settle preempts the landing, the pending twin of the #2949 silent-error-recovery sweep.
