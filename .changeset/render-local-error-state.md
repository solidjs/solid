---
"solid-js": patch
"@solidjs/web": patch
---

Expose a readonly `hasErrors` getter on `renderToStream` results. Hosts that await the full HTML can detect error fallbacks and rejected fragments without replacing the server error hook. The state belongs to each render and does not depend on the hook's once-per-error deduplication, including when a server function reports an error before it escapes into a render.

Serialization errors are recorded when a write throws synchronously or the serializer reports them to a local `onError` hook. Errors suppressed internally by a serializer, or thrown asynchronously without a local hook, are not observable through this getter. Existing streaming, sanitization and error mapping behavior is unchanged. A false value does not prove completion: callers must also account for aborted renders.
