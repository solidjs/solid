---
"solid-js": patch
---

Fix ssrSource "client" and "hybrid" mode hydration for projections and stores

- "client" mode: use a `hydrated` signal gate so the user's function runs only after hydration completes, instead of returning an identity function that never transitions
- "hybrid" mode: use a `hydrated` signal gate to load the server promise during hydration, then transition to the client's async generator post-hydration. A shallow shadow draft absorbs the first iteration's reads/writes (preventing first-value duplication) before switching to the real reactive store
- Fix microtask timing in `hydrateStoreFromAsyncIterable` with a custom thenable so `process` and `asyncWrite` execute in the same microtask
- Skip hydration wrapper for transparent memos (HMR support)
