---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/diagnostics": patch
"@solidjs/compiler": patch
---

Prune the observability surface: `OBSERVE.attribution.install`, the `AttributionHooks` type, `DEV.setConsoleFooter`, the `TraceSlot` and `OriginRef` aliases, `PerformanceTracksOptions.group`, and the untested `solid-js/refresh` runtime modes (`esm`, `webpack5`, `rspack-esm`) are gone — `@solidjs/compiler`'s `transformRefresh({ bundler })` accepts only `"vite" | "standard"` to match. `ownerPath()` is now `OBSERVE.ownerPath(subject)` and `diagnosticGuideUrl()` is `DEV.guideUrl(code)`; `why()` also accepts a scope name. Engine record types (`RerunEvent`, `HoldEvent`, …) live on `solid-js/attribution` only, and `InteractionRef`/`NavigationRef` on the main entries only. `@solidjs/diagnostics` types its record tables off the runtimes' own catalogue (`RecordEvent<K>`), adds the `recovery` table, and bumps the artifact `formatVersion` to 8.
