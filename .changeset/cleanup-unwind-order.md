---
"@solidjs/signals": patch
"solid-js": patch
---

`onCleanup` callbacks on one owner now run in reverse registration order (unwind), restoring the 1.x #1562 semantics; in production, component bodies share the enclosing owner, so a parent that registers cleanup before rendering its children now tears down after them, matching dev (#3572).
