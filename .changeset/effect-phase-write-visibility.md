---
"@solidjs/signals": patch
---

Unify effect-phase write/read semantics (#3006): `onSettled` and `createTrackedEffect` callbacks no longer observe their own unsettled writes. Like the effect half of `createEffect` and event handlers, reads inside them return the settled (committed) values; writes are processed in the same flush's continuation and functional setters still compose. Also adds a dev warning when `flush()` is called from a `createEffect` callback (it was already a silent no-op), and both flush guards now point to the `queueMicrotask(() => flush())` escape hatch.
