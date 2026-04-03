---
"solid-js": patch
---

Align server `createMemo` Promise handling with `@solidjs/signals`: pending promises now always attach `NotReadyError` regardless of initial value, so seeds like `[]` no longer skip Loading/async boundaries.
