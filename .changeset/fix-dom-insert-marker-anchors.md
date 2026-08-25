---
"@solidjs/compiler": patch
---

Fix DOM insert markers to reference the following sibling's declared walk variable (`_$insert(_el$, expr, _el$2)`) instead of re-deriving the walk inline (`_el$.firstChild`), matching babel-plugin output. Affects dynamic slots followed by static content in both single-slot and per-slot parents.
