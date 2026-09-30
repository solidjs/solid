---
"@solidjs/signals": patch
---

A derived store whose first flight is superseded by a synchronous landing now wakes every reader parked on that flight (#3726). When the derive returned a pending promise and a later source write made it return a value synchronously, the projection computed kept `STATUS_UNINITIALIZED` until the flush commit, so the recompute-side settle walk (#3181) that requires initialization skipped it. Readers whose store node the landing left unchanged (`"length" in store` on an array seed, `Object.keys`, an unchanged `length`) had no value notification to fall back on and stayed pending, blank inside a `<Loading>` boundary while a sibling read of the source updated. The sync commit through the setter now retires the flag the way the async landing does, so the walk releases those readers in the same flush.
