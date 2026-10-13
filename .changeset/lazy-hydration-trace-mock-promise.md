---
"solid-js": patch
---

`lazy()` and `lazyModule()` no longer cache a loader promise created while hydration traces an adopted async compute. During the trace the global `Promise` is a never-settling stub, so a loader that builds its promise from it (as Vite's `__vitePreload` does) used to leave `.preload()` and later renders waiting forever (#4013). A load started during the trace is no longer cached, so the next call loads for real.
