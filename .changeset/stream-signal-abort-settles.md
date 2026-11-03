---
"@solidjs/web": patch
---

Aborting `renderToStream`'s `signal` now settles the consumer promises. Before, `await renderToStream(...)` and the promise from `pipeTo` stayed pending forever after an abort, which kept the request alive. The awaited form now resolves with whatever HTML the render had produced, as it already does for a render failure, and still never rejects. `pipeTo`'s promise resolves. As before, nothing more is written to the sink (#4646).
