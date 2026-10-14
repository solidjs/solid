---
"@solidjs/web": patch
---

A synchronous `prepareRequest` hook no longer defers the server-function request by a microtask, so reads adopted during hydration stay inside the hydration trace instead of refetching from the browser (#3959). An async hook is still awaited.
