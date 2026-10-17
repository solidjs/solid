---
"solid-js": patch
"@solidjs/web": patch
---

Expose a readonly `hasErrors` getter on `renderToStream` results. Hosts that await the full HTML can detect error fallbacks and rejected fragments without replacing the server error hook. The state belongs to each render and does not depend on the hook's once-per-error deduplication, including when a server function reports an error before it escapes into a render.

The default hydration serializer now reports failures even without a local error hook. A failed parse or serialization marks the render as errored, reports through the local or global server error policy, and disposes the render without calling `onCompleteAll`. Synchronous default-serializer failures are contained rather than thrown to the caller. Buffered and streamed consumers finish instead of waiting indefinitely. A failure met while the shell is being assembled keeps that shell from the consumer, so `createSSRResponse` answers 500 as for a first-pass failure; HTML already sent to a streaming consumer cannot be recalled.

Custom serializers keep their existing callback contract. Their synchronous write failures and errors reported through a supplied local hook are recorded; errors they suppress internally remain unobservable. A false value does not prove completion: callers must also account for aborted renders.
