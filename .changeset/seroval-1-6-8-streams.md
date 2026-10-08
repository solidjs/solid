---
"solid-js": patch
"@solidjs/web": patch
---

Pin `seroval` and `seroval-plugins` to exactly `1.6.7`: 1.6.8 changed the stream representation in a patch release and grew bundles. Stream detection now requires a real stream — the JSON decoder (server functions, frames) treats a value as a stream only when seroval's `isStream` holds and it has a callable `.on`, so decoded plain data that happens to carry a `__SEROVAL_STREAM__` key stays data. The frames container-trace check, the client container-trace materializer and the render stream's channel guard also recognize seroval's untagged stream class, and the frames border walk tests for an async iterator first.
