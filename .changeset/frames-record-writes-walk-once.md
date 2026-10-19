---
"@solidjs/web": patch
---

Frames: a write that carries only slot records mounts or updates the occurrences it names from the frame's last slot walk instead of walking the whole frame again. A document's records arrive one write per occurrence, so eager hydration walked a page of N occurrences N times (401 walks of a 7,948-element frame on a 400-card page, about 1 s at 4x CPU); it now walks once. Any content change drops the cached walk, and an occurrence the walk did not see falls back to the full sync. A flush's content passes (assets, segments, live holes) now walk only the store's non-slot keys instead of enumerating every record on every write, and deferred hydration keeps its walk across record writes, touching only the occurrences a write names.
