---
"@solidjs/web": patch
---

`serverFunctionUrl(fn, ...args)` is now the url a `GET()` reference's own call requests — `<endpoint>/data/<id>[?args=…]`, built the way the transport builds it, so a `<link rel="preload" as="fetch">` of it (or a prefetch, a service-worker warm, a fetch by hand) matches the later call in every cache that keys on the url (#3440). It takes the reference, like the rest of the surface, because only the reference knows the call is a GET and how its arguments encode; it throws with a pointer for a reference on the default transport (a POST is not described by its url — `invoke(fn, { priority: "low" }, ...args)` starts such a call early), for arguments that need the codec, and for a url past the length at which the call falls back to POST.

The form-post address the function used to build — what a `<form action>` posts to without the runtime, also `fn.url` — is now `serverFunctionActionUrl(fn | id, ...boundArgs)`, with `parseServerFunctionActionUrl(url)` as its inverse (formerly `parseServerFunctionUrl`). The id form remains for the integration that has only an id, reconstructing a callable before the declaring module has loaded. Rendered form actions and `fn.url` are unchanged.
