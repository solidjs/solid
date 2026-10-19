---
"@solidjs/web": patch
---

A server component consumer that mounts while its frame response is already streaming no longer reports a false `ASYNC_WATERFALL` (#4140). The landing promise the mount awaits now carries the request's start (`OBSERVE.attribution.markFlight`): the server-function client hands its response handler `ctx.startedAt`, the frame host stamps the landing it mints for an open flight, and the mount's wrapper inherits that stamp. A re-ask after an error is still new work. Observe and dev builds only; production output is unchanged.
