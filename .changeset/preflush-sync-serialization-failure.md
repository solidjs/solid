---
"@solidjs/web": patch
"solid-js": patch
---

Fail renderToStream when the default serializer reports a synchronous error before the first flush, matching asynchronous failures. No HTML is sent, onCompleteAll is skipped, and createSSRResponse returns 500 when consuming the stream. An error an `<Errored>` contained does not fail the render when it cannot be serialized: its record and the rejection of its source, deferStream or streamed, are sent as a plain Error with its message, the fallback stays, and the error hook hears the failure once. A rejection nothing contained still fails the render.
