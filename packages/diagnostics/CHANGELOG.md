# @solidjs/diagnostics

## 2.0.0-rc.5

### Patch Changes

- Updated dependencies [51ffcb9]
- Updated dependencies [28a1eaf]
- Updated dependencies [ca16891]
- Updated dependencies [751f991]
- Updated dependencies [ed2fb43]
- Updated dependencies [893b8f9]
- Updated dependencies [2023daa]
- Updated dependencies [3e3676b]
- Updated dependencies [09bbe24]
- Updated dependencies [88fa9d6]
- Updated dependencies [fa13761]
- Updated dependencies [90603c5]
- Updated dependencies [a536e29]
- Updated dependencies [4ee9e3b]
- Updated dependencies [1ece086]
- Updated dependencies [0c02d42]
  - @solidjs/signals@2.0.0-rc.5

## 2.0.0-rc.4

### Patch Changes

- Updated dependencies [8d249c7]
- Updated dependencies [f0c3692]
- Updated dependencies [8d249c7]
- Updated dependencies [505c73d]
- Updated dependencies [de9e3cb]
- Updated dependencies [0e37f90]
- Updated dependencies [8d249c7]
- Updated dependencies [b96d7ce]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [8d249c7]
- Updated dependencies [ba6c0b6]
  - @solidjs/signals@2.0.0-rc.4

## 2.0.0-rc.3

### Minor Changes

- a85c889: New package `@solidjs/diagnostics`: agent-consumable diagnostics harness. `captureArtifact()` runs a scenario with the dev-mode diagnostic and attribution channels open and folds both into a serializable artifact; assertion helpers (`expectNoDiagnostics`, `expectDiagnostic`, `expectRerunBudget`, `expectNoWaste`) and scenario budgets (`assertBudget`, checked-in budget files) gate correctness, update granularity, and wasted recomputes; Vitest matchers via `@solidjs/diagnostics/vitest`; a browser bridge (`@solidjs/diagnostics/browser`) plus a structurally-typed Playwright adapter (`@solidjs/diagnostics/playwright`) capture the same artifacts from real pages, with live `whyDidRun`/`costs` queries against an open session; `@solidjs/diagnostics/protocol` publishes the wire types for the vite-plugin dev-server endpoint; `artifactToJSONL()` provides line-oriented egress for offline/agent analysis. `solid-js` now ships a `skills/reactivity-diagnostics` repair guide mapping every diagnostic code to its fix.

### Patch Changes

- Updated dependencies [6717398]
- Updated dependencies [bbcce0a]
  - @solidjs/signals@2.0.0-rc.3
