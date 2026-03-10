---
"solid-js": patch
---

Include `$REFRESH` in the return types of `createStore(fn)`, `createOptimisticStore(fn)`, and `createProjection` to match `@solidjs/signals` upstream types, and re-export `$REFRESH` from `solid-js`
