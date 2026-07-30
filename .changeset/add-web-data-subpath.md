---
"@solidjs/web": minor
---

New `@solidjs/web/data` subpath: router-agnostic `query()` and `action()` (ported from @solidjs/router's next branch) plus a single-flight query channel, extracted from app experiments on TanStack Router and @solidjs/router hosts where the same files ran unchanged.

- `query(fn, name)` — request-deduped async cache. Same key (name + stable argument hash) in a route loader/preload and a component memo returns the same promise; Solid 2 memos unwrap it into the nearest `<Loading>`. Per-request cache in `event.locals` on the server, module-level with observed/timed freshness on the client. Server functions are auto-declared `GET`. `revalidate`, `query.get/set/delete/clear`, and `collectQueries`/`seedQueries` (an explicit SSR seeding channel for hosts that warm the cache outside the render tree) included.
- `action(fn)` — form-bindable mutations: `toString()` renders the server function's real `.url` into `<form action={...}>` (no-JS posts work natively); a document-level submit listener intercepts matching forms and calls the RPC stub.
- Single-flight: `installQueryFlightConsumer()` (client) applies post-mutation query values from the mutation response via `query.set`; `createQueryFlightCollector(warmQueries)` on `@solidjs/web/data/server` produces the `collectFlightData` hook — the host supplies only `warmQueries(href, outcome)`, re-running that location's data loading (TanStack: build a router and `load()`; @solidjs/router: delegate to `createFlightDataCollector`). The `/server` split keeps `@solidjs/web/storage` (node:async_hooks) out of client bundles.

Not yet ported from solid-router: submission state (`useSubmission`), redirect/Response handling, and preload intent semantics.
