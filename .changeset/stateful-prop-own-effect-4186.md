---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Stateful DOM properties (`value`, `checked`, `selected`, `muted`) no longer share a template's grouped binding effect (#4186). Grouped, a change to any sibling binding — `min`/`max` on the same input, a `class` on another element — re-wrote the property and wiped what the user had typed or toggled. Each stateful binding now gets its own effect, the same shape as a lone binding: written whenever its own expression re-runs, with no previous-value guard (#2016). The remaining bindings are split around it in source order — a grouped effect for the bindings before it, then the property, then the bindings after it — so attribute application order is unchanged (#2532: `type` is still applied before `value`). Templates without a stateful property binding compile exactly as before.
