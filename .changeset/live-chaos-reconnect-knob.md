---
"@solidjs/web": patch
---

Dev chaos-reconnect knob for `live`: `configureServerFunctionsServer({ chaosReconnectEvery: ms })` ends every live response N ms after it opens, the way a dying connection ends it (the body breaks off with the stream still open), so the client loop's reconnect path — backoff, `Last-Event-ID`, the digest-equal skip, `onstatus` — runs continuously without a network to break. Applies to every event-stream response the live address answers; inert outside the dev build.
