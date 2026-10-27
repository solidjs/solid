---
"solid-js": patch
---

Hydration never asks again for what the server sent, even when a streamed boundary's fragment rejects with no outcome (no `<Errored>` on the server could draw the failure). The client still renders that fragment fresh, so its graph is created, but every read in it now claims its serialized record: reads the server resolved take their values, and a read whose record is an error throws that error to the nearest client boundary, or is an uncaught error when there is none. Only reads with no record, such as those cut off by a truncated stream, compute. Recovery comes from a real input change or a boundary's `reset()`, as for any hydrated failure.
