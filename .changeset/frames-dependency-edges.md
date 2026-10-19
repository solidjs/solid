---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Frames: a signal or store write during deferred hydration mounts only the slot occurrences the server recorded as its readers, then applies, instead of mounting every pending occurrence first. The server names plain signals (`<owner id>~<n>`) and plain stores (by their root) in server-component renders and emits `sc:deps` records per frame; writes it cannot vouch for (unnamed, derived, optimistic, projection or wide sources) still mount everything first. Apps without server components keep their sizes and code paths.
