---
"@solidjs/web": patch
---

Hydration: a `<Loading>` around `lazy()` whose module is still loading when hydration starts no longer moves its server-rendered nodes once the module lands. The boundary claims those nodes on its late resume, but the enclosing insert had tracked its region as empty, so it re-inserted them, which moved connected nodes and blurred a focused input. While hydration is in progress, an insert whose region is untracked now leaves the incoming nodes in place when every one of them is already a child of its parent. Once hydration completes, inserts behave as before. Fixes #3749.
