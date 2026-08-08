---
"solid-js": patch
"@solidjs/web": patch
---

Server support for live markup holes (Stage 3): `creationStamp()` exposes an owner-creation counter the live-holes engine uses as an impurity gate, boundary output accessors (`Loading`, error boundaries) tag `$lhSkip` so boundary machinery is never treated as a re-runnable hole, and the async-iterable memo pump acquires the response-window hold (`ctx.hold()`) so iterable-fed holes stream every value before the response closes.
