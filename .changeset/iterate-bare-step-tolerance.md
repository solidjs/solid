---
"@solidjs/signals": patch
---

Async-iterable reads now tolerate protocol-loose iterators, matching `for await` semantics. Real producers return a bare `IteratorResult` from `next()` as a promise-free fast path when a value is already buffered — seroval's deserialized streams do — and the iterate loop called `.then` on it directly, crashing with `it.next(...).then is not a function` and halting the reactive system. Any seroval-delivered async iterable read through a memo (a server function's streamed return, an async-iterable slot arg) hit this whenever a yield was already buffered at pull time. Bare steps are now assimilated as already-settled.

Also fixes a latent drop on the same path that predates it: a sync-settled step arriving AFTER an async gap (seroval buffering between pulls, sync-thenable producers mid-stream) was stashed for handleAsync's initial-read consumer — which no longer exists post-gap — so the value never wrote to the node. Post-gap sync settles now write through the async path like their asynchronous twins.
