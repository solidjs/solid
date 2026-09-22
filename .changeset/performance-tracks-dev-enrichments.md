---
"@solidjs/web": patch
"solid-js": patch
---

Performance tracks: findings as markers, JSX-site stacks, richer properties

- Every `DiagnosticEvent` delivered while `enablePerformanceTracks()` is on becomes a marker on the Performance panel's Timings track (`SILENT_HOLD — <App> › <Search>`), coloured by severity; at `warn` or worse it is annotated as a performance issue (`detail.devtools.performanceIssue`) for the Insights sidebar, linking the repair guide's section for the code. Under the scrub only the code, kind and owner travel.
- In dev, the component wrapper stores a `console.createTask(label)` task on the component record (`_component.task`) for components rendered while an attribution engine is installed (a session with nothing enabled pays nothing), and every span and marker is emitted inside the nearest component's task, so the entry's stack in the panel points at the JSX site that rendered the component.
- Rich mode adds `Owner path` (the unfolded runtime path), `Node id` and the root write's `Origin` to every node span.
- `solid-js` exports `diagnosticGuideUrl(code)` — the repair guide URL the console footer already prints.
