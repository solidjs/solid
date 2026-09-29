---
"@solidjs/web": patch
---

`dynamic`: a kept resolution's address delivery no longer trips the dev owned-scope write guard when the source is a memo that already settled the server-component call (`todos = createMemo(() => getTodos())`, `dynamic(() => todos())`, `refresh(todos)` in an action — the multi-flight shape; the hydrated document's first refetch takes the same path). The delivery then runs inside `dynamic`'s own compute rather than a promise microtask; the per-site address signal is now created with `ownedWrite`, since nothing in that compute reads it back. Before, dev builds threw `REACTIVE_WRITE_IN_OWNED_SCOPE` into the nearest error boundary on the first refetch.
