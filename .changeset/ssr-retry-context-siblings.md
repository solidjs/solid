---
"solid-js": patch
---

On the server, a render effect's retry and a projection's re-derive (`createProjection`, `createStore(fn)`, `createOptimisticStore(fn)`) run under their own render's context once a pending source settles, as an async memo's retry already does (#3972). Under concurrent requests they ran under whichever render set the context last, so anything the pass created took the other request's hydration ids.
