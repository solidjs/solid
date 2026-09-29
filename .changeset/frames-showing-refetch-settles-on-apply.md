---
"@solidjs/web": patch
---

Frames: a refetch of a server-component call that a boundary is already showing now settles when its response has applied, not at the response header. The header is not an answer for a showing call — until the new content lands the boundary still shows the previous render — so `isPending(source)` stays true through the refetch and a `yield refresh(source)` inside an action holds its transaction (and any optimistic write in it) until the refetched slot args are on screen, matching what a single-flight mutation already does. Cold mounts and switches to an address nothing shows keep header-time resolution.
