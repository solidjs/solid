---
"@solidjs/web": patch
---

fix(web): a `deferStream` source that rejects on the server hydrates as a rejection, so `reset()` refetches it on the client (#4747)
