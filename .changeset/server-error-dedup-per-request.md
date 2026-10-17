---
"solid-js": patch
"@solidjs/web": patch
---

The server error hook (`configureServerErrors`, a render's `onError`) now hears each error object once per request — once per render when no request is in scope — instead of once per process (#4125). Reusing one `Error` object across requests (a module-level constant, a cached rejection) used to notify only the first request's hook and hand later requests the first request's mapped wire value; each request now gets its own report and its own answer. Within a request the hook hears an error once per `kind`: a direct server-function call that throws during SSR is heard as `server-function`, and the `<Errored>` or `<Loading>` that contains it is heard as `render`, so a render's `onError` alone tells you the render failed. Every road still carries the first mapped value.
