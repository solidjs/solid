---
"@solidjs/web": patch
---

Wire the frames single-flight protocol through `@solidjs/web/frames`: the server entry re-exports `frameTransformFlightResult` (install as `transformFlightResult` on the server-function handler — a mutation whose invalidated payload includes markup answers with regions + envelope in one frame-stream response), and single-flight delivery on the client reads the shared server-functions client instance by construction, since the frames bundle resolves the transport's wire-layer imports to that external entry.
