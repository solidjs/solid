---
"@solidjs/web": patch
---

frames: a frame's error is an errored async value (frames-rulings 3.3, A7). `FrameHost.landing(address)` rejects with the error record at the response's `:error` write, so the mount's content node throws to the nearest client `<Errored>` — the covering `<Loading>` no longer releases over an empty `<solid-frame>`. An error after the landing (a later yield failing, a cut-off stream, a refetch's response erroring) errors the node the same way. The `<Errored>`'s `reset` re-asks: an errored landing is not a landing for a fresh consumer, and the re-read opens a new flight for the same address (the handler records the call behind every address it handles; `callFor`, `@internal`). A response for an address whose mounts show an error writes through instead of being staged. `frame.error` still records the error.
