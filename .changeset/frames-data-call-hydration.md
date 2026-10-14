---
"@solidjs/web": patch
---

Send data server functions called during hydration on a page with server components (#4033). The frames client holds a server-function call while the document may still deliver a boundary for it, and a data function never has one. A wait created under a hydration trace cached the trace's never-settling `Promise` stub, so every later call for that function hung; and a call made after the page's last reveal (a hydration-end recompute) was released only by a reveal that never came. Waits made under a trace are no longer kept, and outstanding waits are released when hydration ends as well as on reveals.
