---
"@solidjs/web": patch
---

Server trace and span ids (the W3C `traceparent` a render mints when the request carries none) are drawn from `Math.random` instead of `crypto.getRandomValues`. The ids need to be unique and well spread, not unguessable, which is also OpenTelemetry's default; the two `getRandomValues` calls cost about 10 µs per streamed render on Node, around 14% of the CPU between a request and its first chunk.
