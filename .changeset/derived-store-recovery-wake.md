---
"@solidjs/signals": patch
"solid-js": patch
---

A render effect reading a derived store that errored, then recovered through `latest()` into a new flight, now re-runs when that flight lands. Before, it never re-ran: an `Errored` around it went back to its content with the value missing, or a `Loading` around it stayed on its fallback.
