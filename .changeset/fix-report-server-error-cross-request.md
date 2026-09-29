---
"solid-js": patch
"@solidjs/web": patch
---

Server errors reach their own request's `onError`, never another request's. The server error hook picked the per-request hook off the module-global `sharedConfig.context`, which is whichever render touched it last, and a finished `renderToString` context stays there. So a failure that landed later from async work went to another in-flight or finished request's `onError`. That request's handler got the error with all its details, and its return became the wire value this request's client received. The affected paths are a `<Loading>` boundary failing from its resume loop (`failed` pre-shell, `client` post-shell), a streamed hydration value that won't serialize, a server function dispatched over HTTP without a handler `onError` (its thrown tail and result-graph channels), and an in-process server-function call during SSR that rejects late or is made after an `await`.

`reportServerError` no longer reads the global context. Every caller passes the hook of the render or request the failure belongs to. Boundaries pass the `errorPolicy` of the context they were created under, and the renderer passes its own `onError`. An HTTP-dispatched server function uses its handler's hook. An in-process call uses the hook of the render serving the request it was made under, which the render files against its request event when it starts. A failure no render or request owns reaches the ambient `configureServerErrors` hook alone.
