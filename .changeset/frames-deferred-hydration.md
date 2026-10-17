---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Server components hydrate their client slot occurrences on demand. The adoption pass mounts none of them; an occurrence mounts when an event lands in it (outermost first, before the event reaches a handler), before any signal or store write applies (every remaining occurrence, against the server's state), or in idle slices after the load event. Hydration stays in progress until the last one has mounted. The write side is an internal pre-write hook in `@solidjs/signals`, tree-shaken from apps without server components.
