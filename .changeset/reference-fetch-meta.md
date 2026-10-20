---
"@solidjs/web": patch
---

A server function reference can declare its own client send with `withMeta(fn, { fetch: (address, init, next) => ... })`. The transport uses it for that function's requests, with the configured send (the app's `fetch`, or the global) as `next`, so an integration that answers some calls itself (a prerendered build's static artifacts) no longer competes with the app's `configureServerFunctionsClient({ fetch })`. Exported type `ServerFunctionsSend`.
