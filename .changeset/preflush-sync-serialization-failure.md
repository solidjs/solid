---
"@solidjs/web": patch
"solid-js": patch
---

Fail renderToStream when the default serializer reports a synchronous error before the first flush, matching asynchronous failures. No HTML is sent, onCompleteAll is skipped, and createSSRResponse returns 500 when consuming the stream. An error record that cannot be serialized (an `<Errored>` record or a deferStream rejection) does not fail the render: it is sent as a plain Error with its message, the fallback stays, and the error hook hears the failure once.
