---
"solid-js": patch
---

Fix streaming SSR hanging permanently (0 bytes, 100% CPU) when a component body reads a property of a pending `createProjection`/`createStore(asyncFn)` store (#3068). An async projection can never be ready at creation-scope read time, so the read threw NotReadyError and the retry re-ran the scope — but `createProjection` allocated a fresh generator, deferred, and serialized promise on every pass, so the read could never succeed and the flush loop spun forever. Server projections now keep by-slot flight memory (the #3003 memo mechanism): a re-created projection at a known slot returns the same in-flight proxy — one generator run, one trace, one serialized channel — and post-settle passes read through it synchronously.
