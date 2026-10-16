---
"@solidjs/web": patch
---

`effect` and `insert` take `loc` beside `name` in their options, and `spread` a trailing `loc` after its tag — the source site the compiler emits under `sourceNames` `locations` — so a diagnostic about a compiled binding reports `at src/App.tsx:14:7` and carries `event.loc`. Dev and observe builds keep it on the node; production ignores it.
