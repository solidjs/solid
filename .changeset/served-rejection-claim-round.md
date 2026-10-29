---
"solid-js": patch
---

A hydrating client never asks again for an async memo the server answered with an error, when a boundary that resumes mid-stream reads it only through another memo (#4375). The resume created a reader (`isPending(m1)` of a memo `m1` over the rejected `m0`) on a later flush round than the one the rejection landed in, so the read retried the errored memo (PJ-R35); `m0` sat in the shell, outside the boundary being claimed, and hydration took the retry for a client write and ran its compute — a real request, with nothing changed. A served rejection now re-serves in a claim window's own round, as it already does in the round a served answer lands in; a write still recomputes it.
