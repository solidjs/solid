---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

`"render"` record and `AttributionOptions.values` — the two remaining places where the observe surface duplicated a record or scrubbed one after the fact.

**`"render"` record** (`@solidjs/web`, server). A server render — `renderToString` or `renderToStream` — is now a record on `OBSERVE.records`: `RenderEvent { mode: "string" | "stream", at, shellMs?, durationMs, boundaries, outcome: "complete" | "abandoned" | "error" }`, delivered when the render ends, with `RenderLive { event?: RequestEvent, trace: TraceContext }` beside it. `shellMs` is render start → the shell complete (the stream's shell handed to the sink; the string's document assembled); `boundaries` counts the `<Loading>` boundaries the shell waited on. Types `RenderEvent`, `RenderLive`, `RenderListener` are exported from `@solidjs/web`.

The response's `Server-Timing` metrics are now strictly projections of records, one gate each (`observed(type) || dev`): `solid-invocation` from the `"invocation"` record, `solid-shell` from the `"render"` record's `shellMs`, `solid-boundary` from each `"boundary"` record the shell waited on — computed from the record objects at head commit, no second push. Wire format unchanged. **Behavior change (observe tier):** `solid-shell` now rides the `"render"` listener, not the `"boundary"` listener; an observe deployment that subscribed to `"boundary"` alone keeps its `solid-boundary` metrics and needs a `"render"` subscription for `solid-shell`. Dev builds still write all three always.

**`AttributionOptions.values: "full" | "labels" | "none"`** (`@solidjs/signals`, re-exported by `solid-js/attribution`). One engine option governs the user-data fields of the engine's records at the source: `ChangeRecord.prev`/`value`, `HeldWrite.prev`/`value`, `ChangeOrigin.target` (and so `InteractionEvent.target`, `HoldEvent.interaction.target`), and every sentence built from them (`formatRerun`, `formatOrigin`, `SILENT_HOLD`/`LONG_HOLD`, `OPTIMISTIC_REVERTED`). `"full"` is today's dev output; `"labels"` drops value previews and keeps element text only on a `button` or an `a`; `"none"` drops both. **The default is the build tier's: `"full"` in dev builds, `"none"` in observe builds** (folded at build time — the observe engine ships `"none"` only). Across holds the **least permissive** level wins; a holder naming no level asks for the tier's default, so in an observe build it tightens to `"none"` beside anyone, while a single holder passing `"full"` there gets `"full"`; an explicit `"full"` never loosens what another holder demanded. Observe-tier consumers that export records should pass their level explicitly and treat it as their export contract.

**Removed:** `PerformanceTracksOptions.scrub` and the adapter's scrub helpers. `@solidjs/web/performance-tracks` paints what the engine put on the record: an observe build's tracks inherit `"none"` (tighter than the old scrub — no element text on buttons/links either); the old observe posture is `enablePerformanceTracks({ attribution: { values: "labels" } })`. **Behavior change:** a finding's marker always carries `event.message`.

Internal: `solid-js`'s server render context seam `_timing` became `_recordBoundary(event: BoundaryEvent)` — the boundary files its record, the web runtime projects the header from it.
