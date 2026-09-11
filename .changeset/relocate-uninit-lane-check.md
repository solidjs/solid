---
"@solidjs/signals": patch
---

Relocate #3277's uninitialized cross-lane suspension check from core `read()` into the optimistic module's `laneSuspends`. No behavior change — the check is only reachable under a lane, which implies the engine is installed — but the inline placement taxed every bundle including storeless floors (27-66 B across five size scenarios); in `laneSuspends` only bundles that retain the optimistic module pay.
