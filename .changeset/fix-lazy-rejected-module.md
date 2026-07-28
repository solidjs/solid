---
"solid-js": patch
---

Handle rejected module promises in `lazy()`. On the server the promise only had a success handler, so a chunk that failed to load left the Suspense boundary's `_loading` flag set forever: `renderToStream` never called `end()`, `renderToStringAsync` never resolved, and the error never reached an enclosing `ErrorBoundary`. The rejection is now tracked alongside the resolved module, the boundary is notified, and the error is thrown where the component renders so `ErrorBoundary` can catch it. The client's hydration branch had the same success-only handler, leaving `sharedConfig.count` pinned and swallowing the error; it now decrements the count and surfaces the rejection to the nearest `ErrorBoundary`.
