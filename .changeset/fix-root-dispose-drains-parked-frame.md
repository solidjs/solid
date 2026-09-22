---
"@solidjs/signals": patch
---

Disposing an owner while an action is pending now runs the cleanups of a memo branch's previous frame. A recompute under a held transaction parks the previous pass's children and `onCleanup`s as zombies until the commit retires them (#3404); the disposal walk never reached that parked frame, and the commit's drain then returned on the `REACTIVE_DISPOSED` flag the walk had set — so the cleanups never ran, and the zombies stayed subscribed and re-ran inside the torn-down tree once a later transaction drained the zombie heap. The death path (`createRoot` disposer, `owner.dispose()`, parent disposal, and a lazy memo losing its last subscriber) now drains the parked frame first; a rerun still leaves it rendering until commit. Fixes #3561.
