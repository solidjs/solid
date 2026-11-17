---
"@solidjs/signals": patch
---

A derivation that leaves a guess lane re-notifies the readers that derived from its lane value, so a `<Show>` no longer switches to a fallback that shows the values from before a held change (#4990).
