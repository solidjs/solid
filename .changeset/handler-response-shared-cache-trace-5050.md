---
"@solidjs/web": patch
---

A route handler's or middleware's own `Response` no longer carries the request's trace in `Server-Timing` when a shared cache may store it (#5050). This is the rule documents (#4938) and `GET` server-function reads (#3985) already follow. The response's own `Cache-Control` / `CDN-Cache-Control` decides, then the response stub's, and only `GET` and `HEAD` answers count.
