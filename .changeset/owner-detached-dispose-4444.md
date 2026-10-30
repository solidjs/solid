---
"@solidjs/signals": patch
---

`createOwner()`'s `dispose` can be passed around as a plain function again — `queueMicrotask(o.dispose)`, `setTimeout(o.dispose)` — instead of throwing `TypeError: Cannot read properties of undefined (reading '_flags')` (#4444). The method was a shared function reading its owner from `this`, which a detached call leaves undefined; the exported `createOwner` now binds it, as `createRoot`'s dispose already was. Internal owners (`mapArray` rows, boundaries) keep the shared method, so they pay no allocation.
