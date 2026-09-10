---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/diagnostics": patch
---

Observe tier: first-class interaction records and a typed record channel.

- `attribution.interactions()` and `InteractionEvent`: one record per `withInteraction` dispatch with `at`, `handlerMs`, `writes`, `runs`, `created` (computations built in its runs), `runMs`, the `holds` and `navigations` attached, and `settledMs`/`outcome` (`idle` | `committed` | `held`) once everything it caused is through.
- `attribution.subscribe(type, listener)` for `"rerun" | "interaction" | "hold" | "navigation"`, delivered synchronously as each record completes; the bare `subscribe(listener)` form is unchanged.
- `RerunEvent.at` and `HoldEvent.at` — absolute times on the `performance.now()` clock beside the existing durations.
- `HoldEvent.acknowledgements` replaces `acknowledgedBy`: one `{ kind, source, reader? }` per affordance, `reader` the owner path of the effect that painted it. `feedback().sources[].acknowledgedBy` still ranks by `kind:source`. `@solidjs/diagnostics` artifact format version 4 (holds carry `acknowledgements`; assertion evidence likewise).
- `NavigationRef.until` — a router that awaits its own loaders hands the engine its completion; the navigation (and the interaction under it) stays open until it settles. While it is open, `withOrigin` with the same ref object re-enters the navigation, so the router's later publish (and the hold it waits in) lands on the same record. `params` values may be `undefined`.
- `OBSERVE.exclude(owner)` / `OBSERVE.isExcluded(subject)` — an observer rendering inside the app it watches marks its own subtree; diagnostics about it are suppressed and the engine records none of its runs.
- `solid-js` re-exports the tier types from its root: `InteractionRef`, `NavigationRef`, `OriginRef`, `DiagnosticEvent` and friends, and the engine's record types (`ChangeOrigin`, `RerunEvent`, `HoldEvent`, `NavigationEvent`, `InteractionEvent`, …).
