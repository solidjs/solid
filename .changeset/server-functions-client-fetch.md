---
"@solidjs/web": patch
---

Add `fetch` to `configureServerFunctionsClient`: the function the transport sends every server-function request with, typed and called as `(address, init)` — the address relative to the document, as the global one receives it — so an ordinary fetch wrapper drops in, a hand-written one needs no casts, and `parseServerFunctionUrl` reads the id back out for telemetry. `null` restores the global.

An app-shaped url is what makes it worth a seam: the handler takes a web `Request`, so a route that rewrites into the canonical address dispatches like any other call, and nothing downstream — the router's action-url interception, the plugin's dev middleware, the generated dispatch gate — has to learn a second address format. A wrapper keeps the call same-origin and hands back what the peer answered; one that answers with anything but a `Response` is told so by name. It is the client transport's exit only: a server-side call runs in process and never reaches a fetch.

Also tidies the `endpoint` documentation on both entries, which the path-addressing change left saying the same thing twice.
