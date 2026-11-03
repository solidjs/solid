---
"@solidjs/web": patch
---

Reject `renderToStream` thenable consumers with `signal.reason` when its `signal` aborts, including consumers registered after cancellation. Render failures still resolve with the available HTML.
