---
"@solidjs/web": patch
---

Drop the request's `Server-Timing` trace entries (`traceparent;desc=…`) from a `GET`/`HEAD` server-function response whose `Cache-Control` lets a shared cache store it (`public` or `s-maxage`, and neither `private` nor `no-store`), so a CDN no longer replays one request's trace to every viewer. Private and non-read responses keep the trace as before.
