---
"@solidjs/web": patch
---

The lean re-ask (frames residue pass §3.3). The server-function client hands its response handler the call it dispatched as a thunk — `ctx.retry` on `responseHandler.handle`, `info.retry` on `responseHandler.intercept` — the same reference, arguments, declared shape and per-call options, so a `GET`-declared read stays a GET by construction. The frames client's re-ask for an errored boundary's `reset` (frames-rulings 3.3) is that thunk: `callFor(address).retry()`. Gone with it: the frames client's `reask` installer and its reads of the RPC slot and the metadata brand, and `createServerReference(id)` on the client half of the server-function RPC slot (`getServerFunctionRPC()`, `@internal`), which nothing reads any more. `callFor` (`@internal`) now returns the recorded call with its `retry`. The `responseHandler` type in `ServerFunctionsClientConfig` documents the existing `intercept` seam alongside `handle`, both carrying `retry`.
