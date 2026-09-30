---
"solid-js": patch
"@solidjs/web": patch
---

Move `createErrorBoundary`, `createLoadingBoundary` and `createRevealOrder` types to `solid-js/internal`; they remain runtime exports of `solid-js` but are no longer part of its public types (#3709)
