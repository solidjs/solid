---
"solid-js": patch
---

While hydrating, retrying an error the server sent no longer asks again. A tracked read of an errored node on a later cycle retries it, for example when a client write re-runs one of its readers. If none of the node's own sources changed, it keeps the server's error. A change to one of its sources still recomputes it, and so does a boundary's `reset()`. Once hydration is over, retries behave as on any client render.
