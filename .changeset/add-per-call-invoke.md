---
"@solidjs/web": minor
---

Add `invoke(fn, options, ...args)` — the per-call server function invocator (#3057). Applies one call with invocation-scoped options: `signal` (aborting rejects the call and cancels the request; ends a live source's iteration across reconnects), `keepalive`, and `priority`. Longer-lived concerns are refused with a redirect to their home (`prepareRequest`, `withMeta`/`GET`, the data layer via `signal`) — never a `RequestInit` passthrough. Dispatch rides a registered-symbol invocation channel (`SERVER_FUNCTION_INVOKE`) that wrappers forward like declaration metadata, so `invoke` composes through `GET`, `live`, and integration wrappers that adapt it. On the server the call runs in-process: `signal` rejects the caller, transport hints are no-ops.
