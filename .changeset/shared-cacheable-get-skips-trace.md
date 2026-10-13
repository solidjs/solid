---
"@solidjs/web": patch
---

A `GET` (or `HEAD`) server-function response whose `Cache-Control` lets a shared cache store it (`public` or `s-maxage`, unless `no-store` or an unqualified `private` is also set) no longer carries the request's trace in `Server-Timing` (`traceparent` and any provider entries), so one request's trace is not replayed to every viewer from the cache (#3985). `POST` responses and documents are unchanged.
