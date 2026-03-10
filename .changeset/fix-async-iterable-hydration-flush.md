---
"solid-js": patch
---

Refactor async iterable hydration to delegate to signals' handleAsync pipeline:
- Replace imperative consumeFirstSync/scheduleIteratorConsumption with normalizeIterator that ensures V1 is sync for snapshot capture and V2+ are greedily batched after a single microtask deferral
- createMemo, createProjection, and createStore(fn) hydration now return async iterables that handleAsync processes natively, eliminating manual flush/schedule management
- Fix hybrid mode: processResult and createProjection .then() callbacks now return values so serialized promises resolve correctly
