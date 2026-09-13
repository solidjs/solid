---
"@solidjs/web": patch
---

Trace context: `getTraceContext()`, W3C `traceparent` on the exchange, and the `OBSERVE.server.trace` provider slot

The server runtime now reads the W3C Trace Context half of the HTTP exchange once per request — continuing an incoming `traceparent` (with `tracestate`/`baggage` beside it) or originating a trace when none came in — and exposes it through `getTraceContext()` from `@solidjs/web`: `{ traceId, spanId, parentId?, sampled?, state?, baggage?, entries }`, one object per request (direct SSR-time server-function calls included), the render's own for a render outside a request scope, `undefined` outside both and on the client. Application code forwards a trace downstream with `entries.traceparent`. This is core HTTP behavior in every build tier.

The trace is also handed down to the browser: `entries` are emitted as `Server-Timing` metrics (`traceparent;desc="00-…"`) when the response head commits — `createSSRResponse`, `commitEventResponse` (now also for an event without a response stub, such as the server-function handler's default event), and `commitResponseStub` (which accepts the owning `event` in its options) — and as `<meta name="…" content="…">` tags in the HTML shell head, delivered wherever the head content goes (`</head>` splice, `onHead`). A `Server-Timing` name the application already wrote is respected; `Server-Timing` now folds entry by entry when a stub and a response/`responseInit` both carry one. The browser is told only when something is recording the trace — the incoming `traceparent` was sampled, or a provider answered — never for a trace the runtime originated alone or an unsampled upstream one (what load balancers and meshes stamp on every request), so an app with no APM sees zero wire change.

In observe/dev builds, `OBSERVE.server.trace.provide(provider)` installs a single global provider whose answer merges over the derivation (fields replace, `entries` merge by name) — how an APM's server SDK contributes its active span and vendor entries (`sentry-trace`/`baggage`) once, with no per-request entry point into the host.
