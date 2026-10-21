---
"@solidjs/signals": patch
---

A projection whose re-run throws in a flush (a signal it reads written just before its promise rejects) reaches the error boundary again (#4189).
