---
"@solidjs/web": patch
---

A direct server-function call no longer enters the request scope or copies property descriptors for each plain object and array in its result. The walk that binds deferred bodies now skips `bindDeferredBody`'s scoped promise probe for a plain object or array that has no own iterator or `Symbol.toStringTag` hook, reads each slot's descriptor on its own, and allocates a frame only for a container whose slots hold an object. Descriptors are still snapshotted before any authored code can run. A call returning 1,000 plain rows walks in 0.11 ms instead of 0.55 ms.
