---
"@solidjs/web": patch
---

Drain hydration records when a fragment reveals into an adopted server-component region. A slot invoked inside a server `<Loading>` ships its `sc:slot:` record with the deferred fragment — about the async's own delay after the boundary adopted, long after the adopt-time drain ran. That record was then stranded: the classification gate's only other re-drain arms on `_$HY.fr.pending()`, and the very reveal that delivers the record is what flips it false (a revealed fragment is no longer pending). The occurrence stayed recordless, so the next full sync — a refetch's stream apply — classified the region's render prop as a direct-insert value and evaluated it as a zero-arg accessor, whose props read halted the reactive system.
