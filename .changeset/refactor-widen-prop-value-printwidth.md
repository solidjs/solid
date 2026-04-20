---
"solid-js": patch
---

Refactor `WidenPropValue` helper in `jsx-properties.d.ts` to split the nested conditional into a small named helper. Behavior-identical; removes a line that sat exactly at `printWidth: 100` so formatters running at the default width no longer fight the repo's prettier config.
