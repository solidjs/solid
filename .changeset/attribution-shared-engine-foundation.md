---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Attribution engine: shared-consumer foundation

- `attribution.enable(opts)` is a hold on the engine and returns its release (idempotent, like `subscribe`). The engine is one per page and shared by every consumer (a profiler track, an APM adapter, a diagnostics capture); it stays installed while any hold remains, and the last release uninstalls and clears everything. Options layer: the defaults with each live hold's options applied in hold order, recomputed when a hold releases — so a consumer that enabled with `log: false` beside a console session gives the log back when it leaves. A hold taken while already enabled opens a fresh window over the ring buffers and folds without disturbing live tracking state or other consumers' subscriptions. `disable()` is the full teardown whatever holds are outstanding (the console's and a test harness's reset) — a consumer sharing the page releases its own hold instead.
- New `AttributionOptions.checks` (default `true`). `false` turns off all five cost checks — `hotRuns`, `hotTime`, `wideDeps`, `unstableMemos`, `wideWrites` — at once, so a records-only consumer pays for none of their bookkeeping. Hold/long-hold/waterfall tracking are unaffected.
- `isSilentHold` and `isLongHold` are exported from `@solidjs/signals/attribution` (inert in prod), so consumers apply the engine's own hold verdicts instead of thresholds of their own.
- `InteractionEvent.at` is now the browser event's own `timeStamp` when `@solidjs/web` dispatches the handler (guarded against epoch-clock stamps), so it equals `PerformanceEventTiming.startTime` for the same interaction — a direct join to INP. New `InteractionEvent.inputDelayMs` reports event creation → handler entry; `handlerMs` is now entry → return, and `settledMs` continues to measure from `at`.
