---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

The route the document arrived on, declared by the router with the call it already uses. `NavigationRef.initial` on `OBSERVE.attribution.withOrigin`: a router wraps the work that establishes its initial match (building its context) instead of a location write, on both sides. On the client the attribution engine opens the frame at the time origin (`at` defaults to `0`, the document's own navigation start; a router mounted late passes its own), takes no `from`, and settles it `committed` with `writes: 0` when the frame closes, so the first `"navigation"` record (`NavigationEvent.initial: true`) names the route the page loaded as — the pageload's route pattern, which every navigation but the first already had. It is a declaration, not a timing: kept out of `feedback().navigations`. On the server, where there is no engine, the server entry's `withOrigin` files the ref on the render, and the request's `"render"` record carries it as `RenderEvent.route` (`{ name, to, params }`, read from the ref when the render settles) — the name a consumer gives the request (`http.route`) where the URL would scatter one page across as many names as it has parameters. New type `RenderRoute` from `@solidjs/web`.

`NavigationRef.interaction`: a router that awaits between the request and the write (guards or loaders resolved in its core before it publishes the location) captures `OBSERVE.attribution.currentOrigin()` in the request and hands it back on the ref, and the write it publishes later joins the click as if it had been synchronous. Declared beats ambient: the key's presence is the declaration, and an interaction on the stack at write time is used only when the key is absent.

`formatOrigin` renders the initial declaration `initial navigation to /users/:id (/users/42)`. Prod artifacts byte-identical; the observe tier's client artifacts byte-identical.
