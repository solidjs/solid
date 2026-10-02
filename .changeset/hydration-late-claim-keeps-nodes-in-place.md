---
"@solidjs/web": patch
---

Hydration: a `<Loading>` around `lazy()` whose module is still loading when hydration starts no longer moves its server-rendered nodes once the module lands. The boundary claims those nodes on its late resume, but the enclosing insert had tracked its region as empty, so it re-inserted them, which moved connected nodes and blurred a focused input. An insert now leaves nodes in place when they already sit in its region in order. Fixes #3749.
