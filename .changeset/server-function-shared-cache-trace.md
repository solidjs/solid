---
"@solidjs/web": patch
---

Drop the request's `Server-Timing` trace entries (`traceparent;desc=…`) from a `GET`/`HEAD` server-function response that a shared cache may store — anything whose `Cache-Control` does not say `no-store` or an unqualified `private`, or whose `CDN-Cache-Control` lets a CDN store it — so a CDN no longer replays one request's trace to every viewer. `no-store`/`private` reads and non-read responses keep the trace as before.
