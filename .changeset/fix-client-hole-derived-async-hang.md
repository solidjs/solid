---
"solid-js": patch
"@solidjs/web": patch
---

Fix SSR hanging when a derived async computation reads a bare `ssrSource: "client"` hole inside `<Loading>`. `createMemo(async …)`, `createProjection`, and `dynamic({ deferStream: true })` whose compute throws the client-hole NotReady now classify FINAL — the boundary hands the subtree off to the client exactly as a direct read does — instead of subscribing a retry to a source that never settles and leaving the response open. A client hole that surfaces before the shell has flushed now takes the same fallback + `$$f` route as one found at discovery, rather than rejecting the fragment over an empty region.
