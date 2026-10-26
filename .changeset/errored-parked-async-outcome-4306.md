---
"solid-js": patch
"@solidjs/web": patch
---

An `<Errored>` whose fallback reads async data, around a `<Loading>` that fails after the shell inside an outer `<Loading>` still pending, now streams its fallback. Before, the failure landed while the fallback's async read was still pending, so the server had no markup for it and the outer fragment arrived with the Errored region blank; the client hydrated against the blank with warnings and showed nothing there. Now a failure whose fragment is parked in a pending outer one (nothing of it shows yet) waits for the fallback to finish: the outer fragment carries it, or, when the outer settles first, the inner fragment streams it once it resolves. The error is serialized with it and the client claims the markup. A failure in a region already shown still settles at once, as before (#4306).
