# @solidjs/diagnostics

## 2.0.0-rc.3

### Minor Changes

- a85c889: New package `@solidjs/diagnostics`: agent-consumable diagnostics harness. `captureArtifact()` runs a scenario with the dev-mode diagnostic and attribution channels open and folds both into a serializable artifact; assertion helpers (`expectNoDiagnostics`, `expectDiagnostic`, `expectRerunBudget`, `expectNoWaste`) and scenario budgets (`assertBudget`, checked-in budget files) gate correctness, update granularity, and wasted recomputes; Vitest matchers via `@solidjs/diagnostics/vitest`; a browser bridge (`@solidjs/diagnostics/browser`) plus a structurally-typed Playwright adapter (`@solidjs/diagnostics/playwright`) capture the same artifacts from real pages, with live `whyDidRun`/`costs` queries against an open session; `@solidjs/diagnostics/protocol` publishes the wire types for the vite-plugin dev-server endpoint; `artifactToJSONL()` provides line-oriented egress for offline/agent analysis. `solid-js` now ships a `skills/reactivity-diagnostics` repair guide mapping every diagnostic code to its fix.

### Patch Changes

- Updated dependencies [6717398]
- Updated dependencies [bbcce0a]
  - @solidjs/signals@2.0.0-rc.3
