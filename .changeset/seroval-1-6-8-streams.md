---
"solid-js": patch
"@solidjs/web": patch
---

Require `seroval` and `seroval-plugins` `~1.6.8`, and recognize the stream values seroval 1.6.8 decodes. Its JSON path now produces streams without the `__SEROVAL_STREAM__` marker, so the JSON decoder (server functions, frames), the frames container-trace check, the client container-trace materializer and the render stream's channel guard now accept both shapes.
