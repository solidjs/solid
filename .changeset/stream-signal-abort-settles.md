---
"@solidjs/web": patch
---

Aborting `renderToStream`'s `signal` now settles and ends every streaming consumer. Before, the promise from `pipeTo` could stay pending forever after an abort, the `readable` view and a `createSSRResponse` body never closed, and a `pipe` sink was never ended, which kept the request alive. Now nothing more is written and each surface ends cleanly, as a close and not an error, since the bytes already sent stay sent: `pipe` ends its sink, `pipeTo` closes its writable and resolves without rejecting, and `readable` closes. `createSSRResponse` ends its `200` body after the shell and still resolves with a bodyless `500` before it. `onError` and `onCompleteAll` are not called. The awaited form rejects with `signal.reason` (see the companion changeset) (#4646).
