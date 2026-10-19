---
"solid-js": patch
---

Retain deferred hydration claims while client-only module imports are pending, including nested Loading boundaries, rejected imports and error fallbacks, so hydration reuses the original server nodes and completes when their claims settle or retire.

Keep nested deferred claims active through later DOM publication and two sequential client module loads, preserving the original nodes, hydration IDs, context and live events until every child finishes. Ownerless render effects keep their ordinary rendering path.

Retain server-rendered content when a deferred hydration boundary activates before its browser module loads, including DOM bindings created outside the boundary. Resolve pending children without recreating their owners, then claim the original nodes when the module settles.
