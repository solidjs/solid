---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Diagnostic code consolidation. Codes are public API (the Sentry fingerprint roots); three renames.

- `WIDE_WRITE` is folded into `HUGE_FAN_OUT` — one code, one threshold story. The core's always-on check warns at 2000 subscribers; the attribution engine's `fanOut` threshold (default 250, was `wideWrites`) warns earlier while it is enabled and reports through the same emitter, so `data.count` is the subscriber count and, from the engine, `data.write` says which write reached it (`"write"`, `"refresh"`, `"async"`). One WeakMap dedupes both reporters (re-warn after another 500). `AttributionOptions.wideWrites` → `fanOut`.
- `SERVER_FN_ERROR_SANITIZED` and `SSR_ERROR_SANITIZED` are one code, `SERVER_ERROR_SANITIZED` — the same fact from two roads. `data.source` is `"server-function"` (severity `error`, from `@solidjs/web/server-functions`) or `"ssr"` (severity `info`, from the SSR `<Errored>`/rejection path); `data.error` is the original and `data.wire` the replacement on both.
- `ASYNC_WATERFALL` is client-only again: the server's boundary-passes verdict is its own code, `SSR_BOUNDARY_WATERFALL` (kind `ssr`; `info` for two sequential waits, `warn` for three or more; `data: { boundary, passes, sequentialMs }`). `data.side` is gone with it.
