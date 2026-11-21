---
"solid-js": patch
---

On the server, a projection or derived optimistic store whose function returns a pending async store (`createProjection(() => rows, …)`, `createOptimisticStore(() => rows, …)`) now waits for that store like a derive that read it, so `<Loading>` shows its fallback and the answer streams in. Before, adopting the pending store threw `NotReadyError` out of the component body.
