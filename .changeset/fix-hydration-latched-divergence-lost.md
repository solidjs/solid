---
"solid-js": patch
---

Fix mid-stream dependency changes being silently lost by hydration-latched computations. A node adopting its serialized server value re-serves it on every recompute while the stream is open (orphaning protection) — but that recompute left the node clean, so a dependency that changed during the hydration window never re-ran the compute afterwards: the change was lost, not deferred. Re-entry into the serialized-adoption path now arms the hydration-end takeover gate (the same mechanism live-branded sources use), re-running exactly the diverged nodes against their live sources once hydration completes. Applies to the default/"server" `ssrSource` paths; hybrid's sync/promise adopt-and-latch semantics are unchanged.
