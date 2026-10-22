---
"@solidjs/signals": patch
---

A rejected async replacement retires the frame it replaces. When an async memo re-ran over a committed value and the new run rejected, the error showed, but the old run's `onCleanup` callbacks and owned children stayed parked until a later run succeeded, so a subscription or timer from the replaced run kept going behind the error. The rejection now disposes the parked frame when it publishes, as a value's commit does (and as a synchronous throw already did). Also pins the existing timing: a run that never committed is cleaned up when it's superseded, and the committed run when its replacement lands (#4222).
