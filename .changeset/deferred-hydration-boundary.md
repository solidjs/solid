---
"solid-js": minor
"@solidjs/web": minor
---

Add `DeferredHydration` to retain server-rendered children until a reactive readiness gate opens. The native hydration owner claims the existing nodes once, preserving context and queued events; disposing a closed boundary releases its pending claim. Client-only rendering shows the optional fallback while waiting.
