---
"solid-js": patch
"@solidjs/web": patch
---

`reportRequestFailure(error, event)` (`@solidjs/web`, server) reports a failure that fails a request outside any render or server function the runtime reports, such as a middleware throw that a framework's request handler catches. The ambient server error hook hears it as `kind: "request"`, `handling: "failed"`, with the request event, once per error object, and its return is ignored. With no hook registered the failure goes to `console.error`, as a render that fails before its shell does. `ServerErrorSite.kind` (`solid-js`) gains `"request"`. On the client the function is a no-op.

A synchronous throw out of `renderToString`, or out of `renderToStream`'s first pass (and so `renderToFrameStream` and `serverComponentResponse`), is now reported to the server error hook as `kind: "render"`, `handling: "failed"` before it is rethrown, where it previously reached the caller without the hook hearing it. A request handler that catches it and calls `reportRequestFailure` adds nothing; the hook hears it once, as the render's.
