---
"solid-js": patch
---

Export `peekNextChildId` from solid-js (client and server builds). It was
already public in `@solidjs/signals` alongside the exported
`getNextChildId`; surfacing it lets external-cache integrations address
the serialized hydration entry of a node they are about to create — e.g.
a data library priming its own cache from the payload its computation
serialized — without consuming the id.
