---
"solid-js": patch
---

Fix `lazy()` rendering nothing, or the Suspense fallback, when an already-loaded component is mounted again. Disposing an instance still releases the shared resource while its import is in flight or has failed, so that load can be collected and retried, but a resolved module stays cached and the next mount renders synchronously.
