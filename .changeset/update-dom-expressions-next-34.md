---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/h": patch
"@solidjs/html": patch
"@solidjs/universal": patch
---

Update dom-expressions to 0.50.0-next.34. Pulls in: single-flight for frames (`frameTransformFlightResult`, flight codec, per-frame versioning and outcome chunks), per-args boundary identity with host retention so cached server-component calls re-materialize instantly and never collide across argument sets, the server-component context barrier hook, keyed slot ranges relocating correctly across parents during morphs, a frame-client size pass, and the typed `transformFlightResult` seam.
