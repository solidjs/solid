---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/diagnostics": patch
---

Server records reach the diagnostics artifact and the dev checks (server-dev-build-plan P4)

- `@solidjs/diagnostics` artifact format **v5**: `artifact.server: { boundaries, invocations } | null` folds `OBSERVE.server.records` when the scenario runs under the server runtime — `captureArtifact(() => renderToStream(…))` — one row per `<Loading>` boundary that waited and per server-function execution; `null` for client captures and the browser bridge. New exported types `ArtifactServer`, `ServerBoundaryRecord`, `ServerInvocationRecord` (mirrors of the runtime's `BoundaryEvent`/`InvocationEvent`; the package still depends on `@solidjs/signals` alone). JSONL egress adds `boundary` and `invocation` lines and the header counts.
- `InvocationEvent.boundary`: a direct server-function call made during a `<Loading>` boundary's render pass carries that boundary's hydration id, the `"boundary"` record's `id` — the join between a boundary's wait and the calls under it.
- Two dev checks derived from the boundary facts in `ssrLoadingBoundary`: `ASYNC_WATERFALL` with `data.side: "server"` (`passes - 1` sequential flights; 2 → `info`, structured only; 3+ → console `warn`) and a new code `SSR_CLIENT_CONTENT_MASKED` (`warn`, `ssr`) for client-only content that surfaced only after a real server wait — the server's work discarded, the fallback shown for the wait. Dev tier only; the boundary clock now runs in dev without a listener.
- `solid-js`'s server `emitFinding` keeps `info` findings off the console (structured channel only), matching the core.
