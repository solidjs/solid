---
"solid-js": patch
---

Fix a per-request SSR memory leak for bare `ssrSource: "client"` sources (#3657). A derived read of a client-only source (`<Show when={client().length}>`, a `dynamic()` source memo, an `<Errored>` aggregate) subscribed its retry to the shared never-settling client-hole promise; those subscriptions could never fire but were never released either, pinning each request's computation, props and data for the life of the process. The client hole is now an inert thenable rather than a native promise — `then` drops its callbacks — so no subscription site can accumulate anything on it. Rendered output is unchanged.
