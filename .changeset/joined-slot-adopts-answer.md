---
"solid-js": patch
---

A server memo re-created at a still-pending slot now takes the slot's answer when the earlier flight settles it (#3815). A retry pass that re-creates a component while its async memo is in flight hands the new memo the slot's shared deferred, but only the earlier memo's promise settles it, so the new memo kept its `NotReadyError` on that already-resolved promise. A memo reading it then retried every microtask, so no timer fired again, the stream never ended and the process sat at 100% CPU. On rc.13 the trigger was a function hole that created a component returning a pending `lazy()` view. On `next` it is an `<Errored>` retry that re-creates a pending `<Loading>`, with a fresh promise per setup and a memo reading it. The joined memo now adopts the slot's value or error when the shared deferred settles, the same way a re-created async-iterable node already did.
