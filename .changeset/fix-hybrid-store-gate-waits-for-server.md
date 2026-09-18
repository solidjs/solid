---
"solid-js": patch
---

Hybrid store hydration waits for the server's answer before handing off to the client (#3498)

Root cause: the hybrid store gate flipped synchronously at the end of the claim pass. With `loadingValue`/`seedLoadingValue` the server serializes a _pending_ placeholder whose real answer arrives later over the stream; flipping before it landed let the client takeover supersede the server flight, so the engine dropped the server's answer and the store never showed it.

The handoff now follows three rules:

1. **It waits for the first server answer to land.** Synchronous when the serialized value is already settled, as before. When it is pending, the handoff happens when that answer lands — resolve or reject — by adopting it as a one-yield stream whose next pull (the engine's own continuation after the landing commits) is the handoff. It never waits on hydration end and never holds hydration open.
2. **Only the handoff run's first yield is the duplicate.** Later runs (a dependency change, `refresh()`) run the client source against the real draft and commit their first yield normally; previously every run kept discarding it.
3. **A rejected server answer is the adopted answer.** The store surfaces the error until a `refresh()` (a non-handoff run) replaces it; the client's handoff run does not paper over the rejection.
