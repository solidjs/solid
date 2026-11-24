---
"@solidjs/web": patch
---

A server function that returns a `ReadableStream` resolves on the client to that `ReadableStream` (`getReader()`, `pipeTo()`, `tee()`), not to a plain async iterable. The top-level abort wrapper applies only to other async iterables, such as an async generator's result. To cancel the call behind a returned stream, call it through `invoke(fn, { signal })` and abort the signal; `cancel()` on the stream stops reading but does not abort the call, the same as for a stream nested in an object.
