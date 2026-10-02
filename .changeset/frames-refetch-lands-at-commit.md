---
"@solidjs/web": patch
---

Server-component content for a call a boundary is showing now lands with the transition that read it, instead of morphing in when the response arrives. A refetch, or a single-flight region, is staged: the call resolves to a binding naming the staged version, and the mount commits it when that binding reaches it. The slot args go first, under the transition, so a fill deriving optimistic intent over a server arg never reads the old arg. The markup lands at the commit. Single-flight regions show when the integration's cache takes the mutation's slice, so any cache that subscribes to flight data drives it, not just Solid Router.

Behaviour change: a response for a showing call that no reader mounts is never shown. Previously it morphed every mount of the address on arrival.
