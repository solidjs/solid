---
"@solidjs/signals": patch
---

Attribution: derive honest `changed` for effect runs. Core executes effects with `_equals: false`, so every effect recompute reported `changed: true` — making effect waste invisible to `costs()` (`wastedMs` was effectively memo-only, while compiled JSX bindings are effects: the fan-out waste of a naive selected-row implementation measured as zero). The engine now compares the effect's committed compute output against its own frame snapshot; identical output reports `changed: false` and accrues waste. Side-effect-only computes (`undefined` output) are exempt.
