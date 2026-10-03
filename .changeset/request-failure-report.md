---
"solid-js": patch
"@solidjs/web": patch
---

`reportRequestFailure(error, event)` (`@solidjs/web`, server) reports a failure that fails a request before any render or server function met it, such as a middleware throw that a framework's request handler catches. The ambient server error hook hears it as `kind: "request"`, `handling: "failed"`, with the request event, once per error object, and its return is ignored. With no hook registered the failure goes to `console.error`, as a render that fails before its shell does. `ServerErrorSite.kind` (`solid-js`) gains `"request"`. On the client the function is a no-op.
