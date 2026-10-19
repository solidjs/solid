---
"@solidjs/signals": patch
---

Settle an immediately empty async iterable to `undefined` when a synchronous thenable resolves to it, matching direct and deferred empty-stream completion instead of exposing the iterable object.
