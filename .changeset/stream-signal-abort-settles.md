---
"@solidjs/web": patch
---

Aborting `renderToStream`'s `signal` now settles the consumer promises. Before, `await renderToStream(...)` and the promise from `pipeTo` stayed pending forever after an abort, which kept the request alive. `pipeTo`'s promise now resolves and, as before, nothing more is written to the sink: the bytes already sent stay sent, and `pipe`/`pipeTo` do not reject. The awaited form rejects with `signal.reason` (see the companion changeset) (#4646).
