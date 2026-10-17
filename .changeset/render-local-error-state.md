---
"solid-js": patch
"@solidjs/web": patch
---

Expose a readonly `hasErrors` getter on `renderToStream` results. Hosts that await the full HTML can detect error fallbacks, rejected fragments and serialization failures without replacing the server error hook. The state belongs to each render and does not depend on the hook's once-per-error deduplication, including when a server function reports an error before it escapes into a render. Existing streaming, sanitization and error mapping behavior is unchanged. A false value does not prove completion: callers must also account for aborted renders.
