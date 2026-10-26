---
"solid-js": patch
"@solidjs/web": patch
---

An `<Errored>` whose fallback reads async data, around a `<Loading>` that fails after the shell, now streams its fallback once that data is ready, and a client hydrating after it arrived claims it. Before, the failure landed while the fallback's read was still pending, so the server had no markup for it. On its own, the boundary swapped to a blank and the client rendered the failure itself, asking for the failed read again. Inside an outer `<Loading>` still pending, the outer fragment arrived with the Errored region blank, and the client hydrated against the blank with warnings and showed nothing there. Now the failure waits for the fallback, as a swap to a fallback waits for the fallback to be ready: the loading placeholder stays until the finished fallback replaces it (carried by the outer fragment when that is still pending), and the error is serialized with it (#4306).
