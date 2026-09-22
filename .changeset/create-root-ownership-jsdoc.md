---
"@solidjs/signals": patch
"solid-js": patch
---

`createRoot` JSDoc now states that a root created inside an owner is disposed with it (detach with `runWithOwner(null, …)`); MIGRATION note added.
