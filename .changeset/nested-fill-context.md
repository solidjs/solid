---
"@solidjs/web": patch
---

Server components: a client fill nested in server content that another fill places (a region) now sees the context that enclosing fill provides, on the server render, at hydration (eager or deferred, including an inner occurrence mounting first) and for occurrences a stream or live hole adds later. On the server, a fill called while an enclosing occurrence's args evaluate renders when the region is placed, under the placing owner; the region's usage flip runs after the fill's output has resolved, so content placed inside a provider (whose children resolve in the walk) ships as markup instead of an occluded record. On the client, a nested fill mounts under the owner that read the region, waits while the region is unplaced, and mounts afresh at the next placement after one is disposed. A fill's two claim windows now share one claim owner, so a fill rooted at a context provider claims its server markup instead of rendering a detached copy.
