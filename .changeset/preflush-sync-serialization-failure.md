---
"@solidjs/web": patch
---

Fail renderToStream when the default serializer reports a synchronous error before the first flush, matching asynchronous failures. No HTML is sent, onCompleteAll is skipped, and createSSRResponse returns 500 when consuming the stream.
