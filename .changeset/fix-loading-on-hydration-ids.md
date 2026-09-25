---
"solid-js": patch
---

Fix hydration of `<Loading on={...}>`: the server's boundary now accounts for the client's `on` dependency node when it fakes the boundary's nesting depth, so content and thunk-fallback element keys match. Previously every element under a boundary with `on` missed its key on hydration (detached duplicates, nothing interactive). The server `Loading` also passes `on` through to `createLoadingBoundary`.
