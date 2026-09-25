---
"@solidjs/web": patch
---

live: a consumer ending a live iteration (`return()` — e.g. a memo re-invoking with new arguments) now COMPLETES the nested streams still open in its answer and leaves nested promises pending, instead of failing them with the transport's own AbortError. A child memo still reading a nested stream saw that error as an uncaught failure and halted the page on a route change. Ending by error (a 4xx, the caller's signal) still fails what is nested.
