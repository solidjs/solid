---
"solid-js": patch
---

Handle rejected module promises in `lazy()`. A failed chunk used to leave the server Suspense `_loading` flag set forever (`renderToStream` never ended, `renderToStringAsync` never resolved) and pin the client hydration `sharedConfig.count`, so the error never reached an `ErrorBoundary`. The rejection is now surfaced to the nearest boundary, and the cached promise is cleared so a later `preload()` or request can retry the import.
