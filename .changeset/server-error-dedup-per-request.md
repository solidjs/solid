---
"solid-js": patch
"@solidjs/web": patch
---

The server error hook (`configureServerErrors`, a render's `onError`) now hears each error object once per request — once per render when no request is in scope — instead of once per process (#4125). Reusing one `Error` object across requests (a module-level constant, a cached rejection) used to notify only the first request's hook and hand later requests the first request's mapped wire value; each request now gets its own report and its own answer. Within a request every road still agrees: a server-function failure that escapes into a `<Loading>` is reported once, as the function's, and the fragment rejection and serialized source carry the same mapped value.
