---
"@solidjs/web": patch
---

SSR now marks a conditionally rendered `<option>` (a signal-driven `<Show>`, `&&` or ternary) `selected` inside a bound `<select value>`.
