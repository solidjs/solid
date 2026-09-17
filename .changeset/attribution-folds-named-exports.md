---
"@solidjs/signals": patch
"@solidjs/diagnostics": patch
---

The attribution engine's folds, queries and formatters are named exports of `@solidjs/signals/attribution` (and `solid-js/attribution`), not methods of `attribution`.

- `costs()`, `feedback()`, `why(target)`, `subscriptions(target)`, `formatRerun(event)`, `formatOrigin(origin)` — import them by name. `attribution` keeps `enable`, `disable`, `subscribe`, `markFlight` and the record ring buffers (`history`, `holds`, `interactions`, `navigations`, `waterfalls`). `attribution.format` is `formatRerun`.
- Why: the fold tables (`costs`, `feedback`) are the dev/agent view of the records and the part of the engine that grows; a production adapter consumes records and never calls them. Each fold's module registers its accounting with the engine's fold seam when it is imported, so under the package's `sideEffects: false` a consumer that only subscribes to records ships neither the tables nor the work of filling them — importing `costs` or `feedback` is what turns them on. Measured: −1,150 B brotli for a records consumer (the size scenario's cap ratcheted to 27.25 KB); tree-shake tests pin it from source and from the built observe artifact.
- New types `AttributionCostTables`; `ScopeCost`/`WriteCost` and the feedback types move with their modules and are still exported from the entry. The prod tier's inert twin exports the same named surface, typed against the real one.
- `@solidjs/diagnostics`: `AttributionCosts`/`AttributionFeedback` are aliases of `AttributionCostTables`/`AttributionFeedbackTables`; the capture and the browser bridge import the folds by name. Artifact shape unchanged.
