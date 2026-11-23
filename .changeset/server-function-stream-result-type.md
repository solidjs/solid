---
"@solidjs/web": patch
---

A server function that returns a `ReadableStream` now resolves to a `ReadableStream` on the client, and cancelling it aborts the call.
