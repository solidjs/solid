---
"@solidjs/signals": patch
---

An effect or memo that catches the `NotReadyError` from reading an async derived store (`createStore(async fn, seed)`, `createProjection`) now re-runs when the store's flight lands, as it does for an async memo (#4070).
