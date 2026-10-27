---
"solid-js": patch
"@solidjs/signals": patch
---

Fix: a streamed `<Loading>` claimed after a client write changed a shell memo it reads now shows the client's value. A hydrated memo adopted while its server answer was still streaming had no snapshot, so once a client write took its compute over, the boundary's claim read the client's value while adopting the server's markup — and kept the server's text (or attribute) for good, since nothing re-ran the binding. The memo's server answer is now its snapshot when it lands, even when the write already superseded it: the claim reads what the markup shows and replays the client's value at its release, as for a written signal. If the client's recompute is still in flight when the boundary resumes, the claim is served the snapshot instead of going pending, so the boundary keeps the server's content (no fallback over it, no detached nodes, no lost queued click) until the client's value lands.
