---
"solid-js": patch
"@solidjs/web": patch
---

Make a held (lazily materialized) container-trace fill hydrate like a resident one.

- The container-trace materializer creates its projection under a detached root. Created under the reading owner, a resident materializer consumed one hydration id per trace at t=0 while a late one (no ambient owner) consumed none, so the sibling after a frame hydrated under different keys in the two runs.
- A trace materialized for a claim (a frame's adopt-time mount, at t=0 or late) parks its replayed backlog beyond the snapshot until hydration ends (the same treatment the store-shaped async-iterable hydration gives its buffered backlog). The claim trusts the server's markup, which shows the snapshot; applying the backlog after the claim lets the DOM catch up with a store that moved past the markup — resident or late. A fresh mount folds the whole backlog at once, as before. The frame marks adopt-time args through a new optional second parameter: `FrameHostOptions.revive(value, claiming?)`, forwarded by `reviveContainerTraces(value, claiming?)` to the installed materializer (`setContainerTraceMaterializer((marker, claiming?) => …)`).
- A frame occurrence held on an unresolved ref or an unprepared arg now mounts with the record it was held on (the one the server interior was rendered from) and applies a record that replaced it meanwhile — refetch, address switch — as the args change it is, instead of claiming old markup with new args.
